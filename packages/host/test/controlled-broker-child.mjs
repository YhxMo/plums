import {
  ControlledProcess,
  controlledProfile,
} from "../dist/controlled-execution.js";
const [node, binary, cwd] = process.argv.slice(2);
const child = new ControlledProcess(
  node,
  binary,
  ["hold"],
  cwd,
  controlledProfile(binary, [cwd], [cwd]),
  (kind, data) => {
    if (kind === "stdout" && data.toString().includes("ready"))
      process.send?.({ pid: child.pid });
  },
);
process.on("message", (m) => {
  if (m === "exit") process.exit(0);
});
