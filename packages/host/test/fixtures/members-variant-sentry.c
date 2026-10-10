/* Synthetic marker inheritance probe. All PIDs are reported for test cleanup. */
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
static void leaf(const char *tag) {
  printf("pid %s %d\n", tag, getpid()); fflush(stdout);
  for (;;) pause();
}
int main(int argc, char **argv) {
  if (argc == 3 && !strcmp(argv[1], "leaf")) { leaf(argv[2]); return 0; }
  if (argc != 1) return 2;
  printf("pid entry %d\n", getpid()); fflush(stdout);
  pid_t child = fork();
  if (!child) leaf("fork");
  child = fork();
  if (!child) { execl(argv[0], argv[0], "leaf", "exec", NULL); _exit(3); }
  child = fork();
  if (!child) { if (setsid() < 0) _exit(4); leaf("setsid"); }
  child = fork();
  if (!child) {
    if (setsid() < 0) _exit(4);
    pid_t grandchild = fork();
    if (!grandchild) leaf("double-fork");
    _exit(grandchild < 0 ? 4 : 0);
  }
  posix_spawnattr_t attr; posix_spawnattr_init(&attr);
  posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP);
  posix_spawnattr_setpgroup(&attr, 0);
  char *args[] = {argv[0], "leaf", "spawn-setpgroup", NULL};
  int spawned = posix_spawn(&child, argv[0], NULL, &attr, args, environ);
  printf("spawn %d\n", spawned); fflush(stdout); posix_spawnattr_destroy(&attr);
  posix_spawnattr_init(&attr);
  posix_spawnattr_setflags(&attr, POSIX_SPAWN_START_SUSPENDED);
  char *true_args[] = {"/usr/bin/true", NULL};
  int true_result = posix_spawn(&child, "/usr/bin/true", NULL, &attr, true_args, environ);
  printf("true-spawn %d\n", true_result);
  if (!true_result) printf("pid true-exec %d\n", child);
  fflush(stdout); posix_spawnattr_destroy(&attr);
  pid_t nested = fork();
  if (!nested) {
    execl("/usr/bin/sandbox-exec", "sandbox-exec", "-p", "(version 1)(allow default)", argv[0], "leaf", "nested", NULL);
    _exit(5);
  }
  usleep(200000);
  int status = 0;
  if (waitpid(nested, &status, WNOHANG) == nested) {
    printf("nested-exit %d\n", status); fflush(stdout);
    {
      typedef int (*Init)(const char *, unsigned long long, char **);
      Init init = (Init)dlsym(RTLD_DEFAULT, "sandbox_init");
      char *error = NULL; errno = 0;
      int ret = init ? init("(version 1)(allow default)", 0, &error) : -1;
      printf("sandbox-init %d errno %d available %d\n", ret, errno, init != NULL); fflush(stdout);

    }
  }
  puts("ready"); fflush(stdout);
  char command; while (read(0, &command, 1) == 1) {}
  return 0;
}
