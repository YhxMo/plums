/* Experimental Seatbelt membership query. Not connected to project execution. */
#include <dlfcn.h>
#include <errno.h>
#include <libproc.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc.h>
#include <time.h>
#include <unistd.h>

enum { FILTER_PATH = 1, CHECK_NO_REPORT = 0x40000000, MAX_ITERATIONS = 50 };
typedef int (*Check)(pid_t, const char *, int, ...);
typedef struct { pid_t pid; uint64_t start; } Member;
typedef struct { Member *members; size_t count; unsigned errors; } Scan;
static Check check;
static int no_report = CHECK_NO_REPORT;
static uint64_t now_ms(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return (uint64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static int path_ok(const char *s, const char *prefix) {
  size_t n = strlen(prefix);
  if (strncmp(s, prefix, n) || strlen(s + n) != 64) return 0;
  for (s += n; *s; s++) if (!((*s >= '0' && *s <= '9') || (*s >= 'a' && *s <= 'f'))) return 0;
  return 1;
}
/* Metadata prevents PID reuse; it is not evidence of sandbox membership. */
static int info(pid_t pid, struct proc_bsdinfo *b) {
  errno = 0;
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, b, sizeof(*b)) == sizeof(*b);
}
static uint64_t start(const struct proc_bsdinfo *b) {
  return (uint64_t)b->pbi_start_tvsec * 1000000 + b->pbi_start_tvusec;
}
static int access_result(pid_t pid, const char *path) {
  errno = 0;
  return check(pid, "file-read-data", FILTER_PATH | no_report, path);
}
static Scan scan(const char *nonce) {
  Scan s = {0};
  int capacity = proc_listallpids(NULL, 0) + 128;
  pid_t *pids = NULL;
  int count = -1;
  for (int i = 0; i < 3; i++) {
    free(pids); pids = calloc(capacity, sizeof(*pids));
    if (!pids) break;
    count = proc_listallpids(pids, capacity * sizeof(*pids));
    if (count >= 0 && count < capacity) break;
    capacity *= 2;
  }
  if (!pids || count < 0 || count >= capacity) { free(pids); s.errors++; return s; }
  s.members = calloc(count ? count : 1, sizeof(*s.members));
  if (!s.members) { free(pids); s.errors++; return s; }
  for (int i = 0; i < count; i++) {
    struct proc_bsdinfo before, after;
    if (pids[i] <= 0) continue;
    if (!info(pids[i], &before)) {
      if (errno != ESRCH) s.errors++;
      continue;
    }
    if (before.pbi_uid != getuid() || before.pbi_status == SZOMB) continue;
    int r = access_result(pids[i], nonce), error = errno;
    if (r < 0 || r > 1) { if (error != ESRCH) s.errors++; continue; }
    if (r != 1) continue;
    if (!info(pids[i], &after)) { if (errno != ESRCH) s.errors++; continue; }
    if (start(&before) == start(&after) && after.pbi_status != SZOMB)
      s.members[s.count++] = (Member){pids[i], start(&before)};
  }
  free(pids); return s;
}
static void dispose(Scan *s) { free(s->members); s->members = NULL; }
static int signal_member(Member m, const char *nonce, int sig) {
  struct proc_bsdinfo b;
  if (!info(m.pid, &b)) return errno == ESRCH ? 0 : -1;
  if (start(&b) != m.start || b.pbi_status == SZOMB) return 0;
  int r = access_result(m.pid, nonce), error = errno;
  if (r < 0 || r > 1) return error == ESRCH ? 0 : -1;
  if (r != 1) return 0;
  /* Another process could still race this syscall. The PID window is not zero. */
  if (kill(m.pid, sig)) return errno == ESRCH ? 0 : -1;
  return 1;
}
static void reap(const char *nonce, unsigned grace, unsigned budget) {
  uint64_t began = now_ms(); unsigned killed = 0, iterations = 0, errors = 0;
  Scan s = scan(nonce);
  if (!s.errors) for (size_t i = 0; i < s.count; i++)
    if (signal_member(s.members[i], nonce, SIGTERM) < 0) errors++;
  dispose(&s);
  while (now_ms() - began < grace && now_ms() - began < budget) usleep(10000);
  Member *stopped = NULL; size_t stopped_count = 0;
  int fixed = 0;
  while (iterations < MAX_ITERATIONS && now_ms() - began < budget) {
    iterations++; s = scan(nonce); errors = s.errors;
    int added = 0;
    for (size_t i = 0; i < s.count; i++) {
      int known = 0;
      for (size_t j = 0; j < stopped_count; j++)
        if (s.members[i].pid == stopped[j].pid && s.members[i].start == stopped[j].start) known = 1;
      if (known) continue;
      int r = signal_member(s.members[i], nonce, SIGSTOP);
      if (r < 0) { errors++; continue; }
      if (!r) continue;
      Member *grown = realloc(stopped, (stopped_count + 1) * sizeof(*stopped));
      if (!grown) { errors++; continue; }
      stopped = grown; stopped[stopped_count++] = s.members[i]; added = 1;
    }
    dispose(&s);
    if (!added && !errors) { fixed = 1; break; }
    usleep(10000);
  }
  /* Kill only reverified members even if an observation failed. */
  for (size_t i = 0; i < stopped_count; i++) {
    int r = signal_member(stopped[i], nonce, SIGKILL);
    if (r > 0) killed++; else if (r < 0) errors++;
  }
  free(stopped);
  do {
    s = scan(nonce);
    if (!s.count && !s.errors && fixed && !errors) break;
    if (now_ms() - began >= budget) break;
    dispose(&s); usleep(10000);
  } while (1);
  errors += s.errors;
  size_t residual = s.count;
  if ((!fixed || errors) && !residual) residual = 1; /* Unknown is never zero. */
  printf("{\"killed\":%u,\"residual\":%zu,\"iterations\":%u,\"ms\":%llu,\"errors\":%u}\n",
    killed, residual, iterations, (unsigned long long)(now_ms() - began), errors);
  dispose(&s);
}
int main(int argc, char **argv) {
  check = (Check)dlsym(RTLD_DEFAULT, "sandbox_check");
  if (!check) { puts("{\"ok\":false,\"reason\":\"SANDBOX_CHECK_UNAVAILABLE\"}"); return 1; }
  const int *exported = dlsym(RTLD_DEFAULT, "SANDBOX_CHECK_NO_REPORT");
  if (exported) no_report = *exported;
  if (argc == 5 && !strcmp(argv[1], "calibrate")) {
    if (!path_ok(argv[3], "/usr/lib/.plums-member-") || !path_ok(argv[4], "/usr/lib/.plums-control-")) return 2;
    char *end; long pid = strtol(argv[2], &end, 10);
    if (*end || pid <= 0 || pid > INT32_MAX) return 2;
    int member = access_result((pid_t)pid, argv[3]), member_errno = errno;
    int control = access_result((pid_t)pid, argv[4]), control_errno = errno;
    int host = access_result(getpid(), argv[3]), host_errno = errno;
    int host_known = access_result(getpid(), "/usr/lib");
    int member_known = access_result((pid_t)pid, "/usr/lib");
    printf("{\"ok\":%s,\"reason\":\"PROJECT_CONTAINER_UNCALIBRATED\",\"member\":%d,\"control\":%d,\"host\":%d,\"hostKnown\":%d,\"memberKnown\":%d,\"noReport\":%d,\"errno\":[%d,%d,%d]}\n",
      member == 1 && control == 0 && host == 0 ? "true" : "false", member, control, host, host_known, member_known, no_report, member_errno, control_errno, host_errno);
    return 0;
  }
  if (argc < 3 || !path_ok(argv[2], "/usr/lib/.plums-member-")) return 2;
  if (access_result(getpid(), argv[2]) != 0) return 2; /* Never reap from inside. */
  if (argc == 3 && !strcmp(argv[1], "scan")) {
    Scan s = scan(argv[2]); printf("{\"members\":[");
    for (size_t i = 0; i < s.count; i++) printf("%s{\"pid\":%d,\"start\":%llu}", i ? "," : "", s.members[i].pid, (unsigned long long)s.members[i].start);
    printf("],\"errors\":%u}\n", s.errors); dispose(&s); return 0;
  }
  if (argc == 5 && !strcmp(argv[1], "reap")) {
    char *g, *b; unsigned long grace = strtoul(argv[3], &g, 10), budget = strtoul(argv[4], &b, 10);
    if (*g || *b || grace != 3000 || budget != 8000) return 2;
    reap(argv[2], grace, budget); return 0;
  }
  return 2;
}
