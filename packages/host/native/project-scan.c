#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Count aliases through owned directory descriptors. Missing aliases fail closed;
   no attempt is made to enumerate files outside the approved root. */
typedef struct Alias { dev_t dev; ino_t ino; nlink_t links; size_t seen; struct Alias *next; } Alias;
static Alias *aliases[4096];
static size_t entries;
static int scan(int fd, unsigned depth) {
  if (depth > 128) return 0;
  DIR *dir = fdopendir(dup(fd));
  if (!dir) return 0;
  int ok = 1;
  struct dirent *entry;
  while (ok) {
    errno = 0;
    entry = readdir(dir);
    if (!entry) { if (errno) ok = 0; break; }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (++entries > 100000) { ok = 0; break; }
    struct stat st;
    if (fstatat(fd, entry->d_name, &st, AT_SYMLINK_NOFOLLOW)) { ok = 0; break; }
    if (S_ISDIR(st.st_mode)) {
      int child = openat(fd, entry->d_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      struct stat actual;
      ok = child >= 0 && !fstat(child, &actual) && actual.st_dev == st.st_dev && actual.st_ino == st.st_ino && scan(child, depth + 1);
      if (child >= 0) close(child);
    } else if (S_ISREG(st.st_mode) && st.st_nlink > 1) {
      size_t bucket = ((unsigned long long)st.st_dev ^ (unsigned long long)st.st_ino) % 4096;
      Alias *a = aliases[bucket];
      while (a && (a->dev != st.st_dev || a->ino != st.st_ino)) a = a->next;
      if (!a) {
        a = calloc(1, sizeof(*a));
        if (!a) { ok = 0; break; }
        a->dev = st.st_dev; a->ino = st.st_ino; a->links = st.st_nlink;
        a->next = aliases[bucket]; aliases[bucket] = a;
      }
      if (a->links != st.st_nlink || ++a->seen > a->links) ok = 0;
    }
  }
  closedir(dir);
  return ok;
}
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat before, after;
  int ok = fd >= 0 && !fstat(fd, &before) && scan(fd, 0);
  int reopened = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  ok = ok && reopened >= 0 && !fstat(reopened, &after) && before.st_dev == after.st_dev && before.st_ino == after.st_ino;
  for (size_t i = 0; i < 4096; i++) {
    Alias *a = aliases[i];
    while (a) { if (a->seen != a->links) ok = 0; Alias *next = a->next; free(a); a = next; }
  }
  if (fd >= 0) close(fd);
  if (reopened >= 0) close(reopened);
  puts(ok ? "verified" : "unverified");
  return ok ? 0 : 1;
}
