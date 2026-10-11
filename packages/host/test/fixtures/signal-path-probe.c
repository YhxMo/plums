/* Synthetic path-identity probe. Signals only the host-owned PID passed in argv. */
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static int marker = -1;
static void continued(int sig) { (void)sig; write(marker, "cont\n", 5); }
static void request(const char *file, const char *target, const char *kind) {
  int result = kill((pid_t)atoi(target), SIGCONT), error = errno;
  int fd = open(file, O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (fd < 0) _exit(3);
  dprintf(fd, "%s %d errno %d\n", kind, result, error);
  close(fd);
}
#ifdef PLUMS_TEST_HOOK
__attribute__((constructor)) static void injected(void) {
  const char *file = getenv("PLUMS_TEST_MARKER"), *target = getenv("PLUMS_TEST_TARGET");
  if (file && target) request(file, target, "injected");
}
#else
int main(int argc, char **argv) {
  if (argc != 6) return 2;
  if (!strcmp(argv[1], "request")) request(argv[2], argv[3], "direct");
  if (!strcmp(argv[1], "reexec")) {
    setenv("DYLD_INSERT_LIBRARIES", argv[5], 1);
    setenv("PLUMS_TEST_MARKER", argv[2], 1);
    setenv("PLUMS_TEST_TARGET", argv[3], 1);
    char *args[] = {argv[4], "inert", argv[2], argv[3], argv[4], argv[5], NULL};
    execv(argv[4], args);
    return 4;
  }
  marker = open(argv[2], O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (marker < 0) return 3;
  signal(SIGCONT, continued);
  puts("ready"); fflush(stdout);
  for (;;) pause();
}
#endif
