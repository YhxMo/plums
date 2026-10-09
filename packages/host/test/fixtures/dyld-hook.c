/* Injected only into a calibrated, synthetic sandbox member. */
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
__attribute__((constructor)) static void injected(void) {
  const char *pid = getenv("PLUMS_TEST_SUPERVISOR"), *file = getenv("PLUMS_TEST_MARKER");
  if (!pid || !file) return;
  int targeted = kill((pid_t)atoi(pid), SIGKILL), target_error = errno;
  int broadcast = kill(-1, SIGKILL), broadcast_error = errno;
  int fd = open(file, O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (fd < 0) return;
  dprintf(fd, "injected target %d errno %d broadcast %d errno %d\n", targeted, target_error, broadcast, broadcast_error);
  close(fd);
}
