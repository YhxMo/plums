#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <dirent.h>
#include <sandbox.h>
#include <limits.h>
#define LIMIT (20 * 1024 * 1024)
static void fail(void) { fputs("Filesystem operation refused\n", stderr); exit(1); }
static void json(const char *s) {
  putchar('"'); for (const unsigned char *p=(const unsigned char*)s; *p; ++p) {
    if (*p=='"'||*p=='\\') { putchar('\\'); putchar(*p); }
    else if (*p<32) printf("\\u%04x",*p); else putchar(*p);
  } putchar('"');
}
static char *quoted(const char *s) {
  size_t n=strlen(s);char *out=calloc(n*2+3,1);if(!out)fail();char *p=out;*p++='"';
  for(size_t i=0;i<n;i++){if(s[i]=='"'||s[i]=='\\')*p++='\\';if((unsigned char)s[i]<32)fail();*p++=s[i];}*p++='"';return out;
}
int main(int argc,char **argv) {
  if(argc!=4)fail();const char *op=argv[1],*root=argv[2],*rel=argv[3];
  if(root[0]!='/'||rel[0]=='/'||strchr(rel,'\\'))fail();
  char canonical[PATH_MAX];if(!realpath(root,canonical)||strcmp(canonical,root))fail();
  char *q=quoted(root),*profile=NULL;
  if(asprintf(&profile,"(version 1)(deny default)(allow file-read* file-write* (subpath %s))(allow process-info*)(allow sysctl-read)",q)<0)fail();
  char *error=NULL;if(sandbox_init(profile,0,&error)!=0)fail();free(q);free(profile);
  int rootfd=open(root,O_RDONLY|O_DIRECTORY|O_NOFOLLOW_ANY|O_CLOEXEC);if(rootfd<0)fail();
  char *copy=strdup(rel);if(!copy)fail();int parent=dup(rootfd);char *save=NULL,*part=strtok_r(copy,"/",&save),*last=NULL;
  while(part){if(!strcmp(part,"..")||(!strcmp(part,".")&&strcmp(rel,".")))fail();char *next=strtok_r(NULL,"/",&save);
    if(next){int child=openat(parent,part,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(child<0)fail();close(parent);parent=child;}else last=part;part=next;
  }
  if(!last)fail();
  int flags=O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC;
  if(!strcmp(op,"list"))flags|=O_RDONLY|O_DIRECTORY;
  else if(!strcmp(op,"read"))flags|=O_RDONLY;
  else if(!strcmp(op,"write"))flags|=O_WRONLY|O_CREAT;else fail();
  int fd=openat(parent,last,flags,0600);if(fd<0)fail();struct stat st;if(fstat(fd,&st))fail();
  if(!strcmp(op,"list")) {
    DIR *dir=fdopendir(fd);if(!dir)fail();putchar('[');int first=1;struct dirent *ent;
    while((ent=readdir(dir))){if(!strcmp(ent->d_name,".")||!strcmp(ent->d_name,".."))continue;
      struct stat es;if(fstatat(dirfd(dir),ent->d_name,&es,AT_SYMLINK_NOFOLLOW))fail();
      if(!first)putchar(',');first=0;fputs("{\"name\":",stdout);json(ent->d_name);fputs(",\"type\":",stdout);
      json(S_ISREG(es.st_mode)?"file":S_ISDIR(es.st_mode)?"directory":S_ISLNK(es.st_mode)?"symlink":"other");putchar('}');
    }putchar(']');closedir(dir);
  } else {
    if(!S_ISREG(st.st_mode))fail();char buf[65536];size_t total=0;ssize_t n;
    if(!strcmp(op,"read")){while((n=read(fd,buf,sizeof(buf)))>0){total+=(size_t)n;if(total>LIMIT)fail();if(fwrite(buf,1,(size_t)n,stdout)!=(size_t)n)fail();}if(n<0)fail();}
    else {if(ftruncate(fd,0))fail();while((n=read(STDIN_FILENO,buf,sizeof(buf)))>0){total+=(size_t)n;if(total>LIMIT)fail();ssize_t at=0;while(at<n){ssize_t written=write(fd,buf+at,(size_t)(n-at));if(written<=0)fail();at+=written;}}if(n<0||fsync(fd))fail();}
    close(fd);
  }
  close(parent);close(rootfd);free(copy);return 0;
}
