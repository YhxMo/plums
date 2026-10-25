import { useEffect, useRef, useState } from "react";
import {
  readRoleCardFile,
  readRoleCardLink,
  type RoleCardSource,
} from "@modules/agents/role-card";
import { readBundle, type ReadBundle } from "@modules/agents/agent-bundle";

/** A whole-Agent file: named .plums, or a zip by its first bytes. */
async function isBundle(file: File) {
  if (/\.plums$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head.join() === "80,75,3,4";
}

export type RoleCardDraft = {
  raw: string;
  /** The picture of a picture card, until the text is changed by hand. */
  picture?: Blob;
  /** The rest of a whole-Agent file: its parts and their packages. */
  bundle?: ReadBundle;
  url: string;
  reading: boolean;
  setRaw(value: string): void;
  setUrl(value: string): void;
  readLink(): Promise<void>;
  readFile(file: File): Promise<void>;
  cancelRead(): void;
};

export function useRoleCardDraft(
  setError: (message: string) => void,
): RoleCardDraft {
  const [card, setCard] = useState<RoleCardSource & { bundle?: ReadBundle }>({
    text: "",
  });
  const [url, setUrl] = useState("");
  const [reading, setReading] = useState(false);
  const readController = useRef<AbortController | null>(null);
  useEffect(() => () => readController.current?.abort(), []);
  function cancelRead() {
    readController.current?.abort();
    readController.current = null;
    setReading(false);
  }
  async function readLink() {
    const controller = new AbortController();
    readController.current = controller;
    setReading(true);
    setError("");
    try {
      const read = await readRoleCardLink(url, controller.signal);
      if (readController.current === controller) setCard(read);
    } catch (e) {
      if (readController.current === controller && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (readController.current === controller) {
        readController.current = null;
        setReading(false);
      }
    }
  }
  async function readFile(file: File) {
    if (await isBundle(file)) {
      const bundle = await readBundle(file);
      setCard({ ...bundle.card, bundle });
    } else setCard(await readRoleCardFile(file));
  }
  return {
    raw: card.text,
    picture: card.picture,
    bundle: card.bundle,
    url,
    reading,
    // Text typed or pasted is a card of its own, without the picture.
    setRaw: (text) => setCard({ text }),
    setUrl,
    readLink,
    readFile,
    cancelRead,
  };
}
