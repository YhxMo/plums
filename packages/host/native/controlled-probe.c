#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <spawn.h>
#include <string.h>
extern char **environ;
static int readable(const char *p) { int fd=open(p,O_RDONLY); if(fd<0)return 0; char b; int ok=read(fd,&b,1)==1; close(fd);return ok; }
static int writable(const char *p) {int fd=open(p,O_WRONLY|O_CREAT|O_TRUNC,0600);if(fd<0)return 0;int ok=write(fd,"fixture",7)==7;close(fd);return ok;}
static int tcp(int port) {int s=socket(AF_INET,SOCK_STREAM,0);if(s<0)return 0;struct sockaddr_in a={0};a.sin_len=sizeof(a);a.sin_family=AF_INET;a.sin_port=htons(port);a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);int ok=connect(s,(struct sockaddr*)&a,sizeof(a))==0;close(s);return ok;}
static int udp6(int port) {int s=socket(AF_INET6,SOCK_DGRAM,0);if(s<0)return 0;struct sockaddr_in6 a={0};a.sin6_len=sizeof(a);a.sin6_family=AF_INET6;a.sin6_port=htons(port);a.sin6_addr=in6addr_loopback;int ok=sendto(s,"fixture",7,0,(struct sockaddr*)&a,sizeof(a))==7;close(s);return ok;}
static int unix_socket(const char *p) {int s=socket(AF_UNIX,SOCK_STREAM,0);if(s<0)return 0;struct sockaddr_un a={0};a.sun_len=sizeof(a);a.sun_family=AF_UNIX;strlcpy(a.sun_path,p,sizeof(a.sun_path));int ok=connect(s,(struct sockaddr*)&a,sizeof(a))==0;close(s);return ok;}
int main(int argc,char **argv) {
  if(argc>1&&!strcmp(argv[1],"hold")){signal(SIGTERM,SIG_IGN);puts("ready");fflush(stdout);for(;;)pause();}
  if(argc!=12)return 2;
  int canfork=0;pid_t child=fork();if(child==0)_exit(0);if(child>0){canfork=1;waitpid(child,NULL,0);}
  pid_t spawned=0;char *args[]={"/bin/echo","fixture",NULL};int spawnok=posix_spawn(&spawned,"/bin/echo",NULL,NULL,args,environ)==0;if(spawnok)waitpid(spawned,NULL,0);
  int inherited=0;for(int i=3;i<64;i++)if(fcntl(i,F_GETFD)!=-1)inherited++;
  printf("{\"readAllowed\":%d,\"readOutside\":%d,\"readOtherAgent\":%d,\"readSymlink\":%d,\"writeScratch\":%d,\"writeOutside\":%d,\"readWriteOnly\":%d,\"writeReadOnly\":%d,\"tcp\":%d,\"udp6\":%d,\"unix\":%d,\"fork\":%d,\"spawn\":%d,\"setsid\":%d,\"signalHost\":%d,\"inheritedDescriptors\":%d,\"environmentSecret\":%d}",readable(argv[1]),readable(argv[2]),readable(argv[3]),readable(argv[4]),writable(argv[5]),writable(argv[6]),readable(argv[7]),writable(argv[1]),tcp(atoi(argv[8])),udp6(atoi(argv[8])),unix_socket(argv[9]),canfork,spawnok,setsid()!=-1,kill(atoi(argv[10]),0)==0,inherited,getenv("PLUMS_FIXTURE_SECRET")!=NULL);
  fflush(stdout);
  // Attempt an in-process exec after reporting, independent of posix_spawn/fork.
  execl("/bin/sh","sh","-c",argv[11],NULL);
  puts("\nexecDenied");return 0;
}
