/* Synthetic process-container experiment, not shipped with the application. */
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
static int marker = -1;
static pid_t owner;
static int pulse;
static void continued(int sig) { (void)sig; if(marker>=0) write(marker,"cont\n",5); }
static void kill_owner(int sig) { (void)sig; kill(owner,SIGKILL); }
static void leaf(const char *file, pid_t parent) {
  owner=parent;
  marker=open(file,O_WRONLY|O_CREAT|O_APPEND,0600); if(marker<0)_exit(3);
  char b[64]; int n=snprintf(b,sizeof(b),"pid %d\n",getpid());write(marker,b,n);
  signal(SIGCONT,continued);signal(SIGUSR1,kill_owner);signal(SIGTERM,SIG_IGN);
  puts("ready");fflush(stdout);
  for(;;) { if(pulse) { write(marker,"tick\n",5); usleep(20000); } else pause(); }
}
int main(int argc,char **argv) {
  if(argc!=4 && argc!=5)return 2;
  pulse=argc==5 && !strcmp(argv[4],"pulse");
  if(!strcmp(argv[1],"leaf")){leaf(argv[2],(pid_t)atoi(argv[3]));return 0;}
  signal(SIGTERM,SIG_IGN);
  if(!strcmp(argv[1],"sentry")){leaf(argv[2],0);return 0;}
  pid_t pid=getpid(), child;
  if(!strcmp(argv[1],"kill-supervisor")) {
    int r=kill((pid_t)atoi(argv[3]),SIGKILL), error=errno;
    int f=open(argv[2],O_WRONLY|O_CREAT|O_APPEND,0600);if(f<0)return 3;
    dprintf(f,"signal %d errno %d\n",r,error);close(f);leaf(argv[2],0);return 0;
  }
  if(!strcmp(argv[1],"dyld-inject")) {
    const char *hook=getenv("PLUMS_TEST_DYLD_HOOK");if(!hook)return 2;
    setenv("DYLD_INSERT_LIBRARIES",hook,1);setenv("PLUMS_TEST_SUPERVISOR",argv[3],1);setenv("PLUMS_TEST_MARKER",argv[2],1);
    char *args[]={argv[0],"sentry",argv[2],"0","pulse",NULL};execv(argv[0],args);return 4;
  }
  char parent[32];snprintf(parent,sizeof(parent),"%d",pid);
  if(!strcmp(argv[1],"fork-burst")) {
    for(int i=0;i<64;i++) { child=fork();if(child<0)return 4;if(!child){pulse=1;leaf(argv[2],pid);}usleep(1000); }
  } else if(!strcmp(argv[1],"spawn-setpgroup") || !strcmp(argv[1],"posix-spawn")) {
    posix_spawnattr_t attr;posix_spawnattr_init(&attr);
    if(!strcmp(argv[1],"spawn-setpgroup")){posix_spawnattr_setflags(&attr,POSIX_SPAWN_SETPGROUP);posix_spawnattr_setpgroup(&attr,0);}
    char *args[]={argv[0],"leaf",argv[2],parent,pulse?"pulse":NULL,NULL};
    if(posix_spawn(&child,argv[0],NULL,&attr,args,environ))return 4;
    posix_spawnattr_destroy(&attr);
  } else {
    child=fork();if(child<0)return 4;
    if(!child){
      if(!strcmp(argv[1],"setsid") && setsid()<0)_exit(5);
      if(!strcmp(argv[1],"setpgid") && setpgid(0,0)<0)_exit(5);
      if(!strcmp(argv[1],"double-fork")){if(setsid()<0)_exit(5);pid_t p=fork();if(p<0)_exit(5);if(p>0)_exit(0);}
      leaf(argv[2],pid);
    }
  }
  char command;
  while(read(0,&command,1)==1) {
    if(command=='c') {int r=kill(-1,SIGCONT);printf("scope %d\n",r);fflush(stdout);}
    if(command=='s') {kill(-1,SIGTERM);usleep(100000);kill(-1,SIGKILL);return 6;}
  }
  return 0;
}
