import { useEffect, useRef, useState } from "react";
import {
  readRoleCardFile,
  readRoleCardLink,
} from "../../modules/agents/role-card";

export type RoleCardDraft = {
  raw: string;
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
  const [raw, setRaw] = useState("");
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
      const card = await readRoleCardLink(url, controller.signal);
      if (readController.current === controller) setRaw(card);
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
    setRaw(await readRoleCardFile(file));
  }
  return { raw, url, reading, setRaw, setUrl, readLink, readFile, cancelRead };
}
