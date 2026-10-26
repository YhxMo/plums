import { expect, it } from "vitest";
import { useAgentDraft } from "../src/agents/draft";

it("starts a new draft without the picture of the card added before", () => {
  const draft = useAgentDraft.getState();
  draft.reset({ name: "有头像", avatar: "data:image/png;base64,AA==" });
  expect(useAgentDraft.getState().avatar).toBe("data:image/png;base64,AA==");
  useAgentDraft.getState().reset();
  expect(useAgentDraft.getState()).toMatchObject({ name: "" });
  expect(useAgentDraft.getState().avatar).toBeUndefined();
});
