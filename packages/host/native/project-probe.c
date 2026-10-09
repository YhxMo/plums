#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static char root[1024];
static void filename(char *out, const char *name) {
  if (snprintf(out, 2048, "%s/%s", root, name) >= 2048) exit(2);
}
static int read_file(const char *name) {
  char p[2048], b; filename(p, name);
  int fd = open(p, O_RDONLY | O_NONBLOCK); if (fd < 0) return 0;
  int ok = read(fd, &b, 1) == 1; close(fd); return ok;
}
static int write_file(const char *name) {
  char p[2048]; filename(p, name);
  int fd = open(p, O_WRONLY | O_CREAT | O_TRUNC | O_NONBLOCK, 0600);
  if (fd < 0) return 0;
  int ok = write(fd, "changed", 7) == 7; close(fd); return ok;
}
static int rename_file(const char *from, const char *to) {
  char a[2048], b[2048]; filename(a, from); filename(b, to);
  return rename(a, b) == 0;
}
static int spawn_program(const char *program, char *const args[], short flags) {
  posix_spawnattr_t attributes;
  if (posix_spawnattr_init(&attributes) != 0) return 0;
  posix_spawnattr_setflags(&attributes, flags);
  posix_spawnattr_setpgroup(&attributes, 0);
  pid_t pid = 0;
  int result = posix_spawn(&pid, program, NULL, &attributes, args, environ);
  posix_spawnattr_destroy(&attributes);
  if (result != 0) return 0;
  int status; while (waitpid(pid, &status, 0) < 0) if (errno != EINTR) return 0;
  return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}
static int fork_test(int session) {
  pid_t pid = fork(); if (pid < 0) return 0;
  if (pid == 0) _exit(session ? (setsid() < 0 ? 1 : 0) : 0);
  int status; while (waitpid(pid, &status, 0) < 0) if (errno != EINTR) return 0;
  return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}
static int tcp(int port) {
  int s = socket(AF_INET, SOCK_STREAM, 0); if (s < 0) return 0;
  struct sockaddr_in a = {0}; a.sin_len = sizeof(a); a.sin_family = AF_INET;
  a.sin_port = htons(port); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  int ok = connect(s, (struct sockaddr *)&a, sizeof(a)) == 0; close(s); return ok;
}
static int udp(int port) {
  int s = socket(AF_INET, SOCK_DGRAM, 0); if (s < 0) return 0;
  struct sockaddr_in a = {0}; a.sin_len = sizeof(a); a.sin_family = AF_INET;
  a.sin_port = htons(port); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  int ok = sendto(s, "fixture", 7, 0, (struct sockaddr *)&a, sizeof(a)) == 7;
  close(s); return ok;
}
static int unix_socket(void) {
  int s = socket(AF_UNIX, SOCK_STREAM, 0); if (s < 0) return 0;
  struct sockaddr_un a = {0}; a.sun_len = sizeof(a); a.sun_family = AF_UNIX;
  char p[2048]; filename(p, "project/probe.sock");
  if (strlcpy(a.sun_path, p, sizeof(a.sun_path)) >= sizeof(a.sun_path)) { close(s); return 0; }
  int ok = connect(s, (struct sockaddr *)&a, sizeof(a)) == 0; close(s); return ok;
}
int main(int argc, char **argv) {
  /* Helpers always terminate; even process-group checks create no background work. */
  if (argc == 3 && !strcmp(argv[1], "group"))
    return getpgrp() != (pid_t)atoi(argv[2]) ? 0 : 1;
  if (argc != 4 || strlcpy(root, argv[1], sizeof(root)) >= sizeof(root)) return 2;
  alarm(6);
  puts("ready"); fflush(stdout);
  char command[16]; if (!fgets(command, sizeof(command), stdin) || strcmp(command, "probe\n")) return 2;
  char own[2048], group[32]; filename(own, "platform/snapshot/project-probe");
  snprintf(group, sizeof(group), "%d", getpgrp());
  char *group_args[] = {own, "group", group, NULL};
  char *shell_args[] = {"/bin/sh", "-c", "printf fixture > shell-marker", NULL};
  char *nested_args[] = {"/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/bin/sh", "-c", "exit 0", NULL};
  int inherited = 0; for (int i = 3; i < 64; i++) if (fcntl(i, F_GETFD) != -1) inherited++;
  printf("{\"readProject\":%d,\"writeProject\":%d,\"writeHome\":%d,\"writeTemporary\":%d,\"writeCache\":%d,\"readSnapshot\":%d,\"fork\":%d,\"shell\":%d,\"readOutside\":%d,\"writeOutside\":%d,\"writeDotDot\":%d,\"writeSymlink\":%d,\"renameOut\":%d,\"renameIn\":%d,\"readPrivate\":%d,\"readSibling\":%d,\"readSsh\":%d,\"readKeychain\":%d,\"readNpm\":%d,\"readGit\":%d,\"readCargo\":%d,\"writeToolchain\":%d,\"writeSnapshot\":%d,\"tcp\":%d,\"udp\":%d,\"unixSocket\":%d,\"signalHost\":%d,\"setsid\":%d,\"spawnNewGroup\":%d,\"nestedSandbox\":%d,\"inheritedDescriptors\":%d,\"inheritedEnvironment\":%d,\"readHardlink\":%d,\"writeHardlink\":%d,\"readLateHardlink\":%d,\"writeLateHardlink\":%d}\n",
    read_file("project/data"), write_file("project/written"),
    write_file("platform/private/own/home/written"), write_file("platform/private/own/tmp/written"), write_file("platform/private/own/cache/written"),
    read_file("platform/snapshot/data"), fork_test(0), spawn_program("/bin/sh", shell_args, 0),
    read_file("outside/data"), write_file("outside/written"), write_file("project/../outside/dotdot"), write_file("project/symlink"),
    rename_file("project/rename", "outside/renamed-out"), rename_file("outside/rename", "project/renamed-in"),
    read_file("platform/other-agent/secret"), read_file("platform/private/sibling/secret"), read_file("user-home/.ssh/key"), read_file("user-home/Library/Keychains/key"),
    read_file("user-home/.npmrc"), read_file("user-home/.gitconfig"), read_file("user-home/.cargo/credentials.toml"),
    write_file("user-home/toolchain/data"), write_file("platform/snapshot/data"),
    tcp(atoi(argv[3])), udp(atoi(argv[3])), unix_socket(), kill((pid_t)atoi(argv[2]), 0) == 0,
    fork_test(1), spawn_program(own, group_args, POSIX_SPAWN_SETPGROUP), spawn_program("/usr/bin/sandbox-exec", nested_args, 0),
    inherited, getenv("PLUMS_PROJECT_SENTINEL") != NULL || getenv("NODE_OPTIONS") != NULL || getenv("DYLD_INSERT_LIBRARIES") != NULL,
    read_file("project/private-alias"), write_file("project/outside-alias"),
    read_file("project/late-private-alias"), write_file("project/late-outside-alias"));
  fflush(stdout); return 0;
}
