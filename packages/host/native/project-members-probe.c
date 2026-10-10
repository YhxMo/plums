/* Read-only sandbox_check experiment. Never signals a process; never shipped. */
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
typedef int (*Check)(pid_t, const char *, int, ...);
int main(int argc, char **argv) {
  if (argc != 6 || strcmp(argv[1], "check")) return 2;
  int kind;
  const char *constant = "known";
  if (!strcmp(argv[4], "path")) kind = 1;
  else if (!strcmp(argv[4], "global-name")) {
    int *value = dlsym(RTLD_DEFAULT, "SANDBOX_FILTER_GLOBAL_NAME");
    kind = value ? *value : 2;
    constant = value ? "exported" : "guessed";
  } else return 2;
  int *flag = dlsym(RTLD_DEFAULT, "SANDBOX_CHECK_NO_REPORT");
  int no_report = flag ? *flag : 0x40000000;
  Check check = (Check)dlsym(RTLD_DEFAULT, "sandbox_check");
  errno = 0;
  int ret = check ? check((pid_t)atoi(argv[2]), argv[3], kind | no_report, argv[5]) : -1;
  if (!check) errno = ENOSYS;
  printf("{\"ret\":%d,\"errno\":%d,\"constant\":\"%s\",\"filter\":%d,\"noReport\":%d}\n",
    ret, errno, constant, kind, no_report);
  return 0;
}
