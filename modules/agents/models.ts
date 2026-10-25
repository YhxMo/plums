import type { Provider } from "@modules/sdk";
import type { ChatService } from "@extensions/contracts";
import type { ModelChoice } from "./contract";
import { MAX_MODEL_ID } from "./validation";

/** The models every active `chat@1` provider lists, as an Agent or its memory picks them. */
export const chatModels = (
  chats: readonly Provider<ChatService>[],
): ModelChoice[] =>
  chats.flatMap(({ id, label, value }) =>
    value
      .models()
      .filter(({ id: model }) => model.length <= MAX_MODEL_ID)
      .map(
        ({
          id: model,
          label: name,
          description,
          group,
          reasoning,
          vision,
        }) => ({
          provider: id,
          providerLabel: label,
          group: group ?? label,
          id: model,
          label: name,
          description,
          ...(reasoning?.length && { reasoning }),
          ...(vision && { vision }),
        }),
      ),
  );
