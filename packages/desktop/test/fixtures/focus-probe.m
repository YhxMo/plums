/* Read activation metadata for the caller's own synthetic Electron process. */
#import <AppKit/AppKit.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 2) return 2;
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:atoi(argv[1])];
    if (!app) return 3;
    BOOL requested = argc == 3 && !strcmp(argv[2], "activate");
    BOOL result = requested ? [app activateWithOptions:NSApplicationActivateIgnoringOtherApps] : NO;
    printf("{\"active\":%s,\"hidden\":%s,\"policy\":%ld,\"requested\":%s,\"result\":%s}\n",
      app.active ? "true" : "false", app.hidden ? "true" : "false",
      (long)app.activationPolicy, requested ? "true" : "false", result ? "true" : "false");
  }
}
