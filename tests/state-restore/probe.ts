import { PlatformAdapter } from "../../src/platform";
import { runRestoreScenario } from "./scenario";
const button = document.querySelector<HTMLButtonElement>("#run")!;
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    document.querySelector("#result")!.textContent = JSON.stringify(
      await runRestoreScenario(new PlatformAdapter()),
      null,
      2,
    );
  } catch (error) {
    document.querySelector("#result")!.textContent = JSON.stringify({
      passed: false,
      error: String(error),
    });
  }
});
