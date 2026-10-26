import { useEffect, useRef, useState } from "react";
import { readPackage } from "@modules/shell/extension-package";
import type { PackageOutcome } from "@modules/sdk";
import type { Runtime } from "@/shell/runtime";
import { errorMessage } from "@/shell/messages";
import type { ShellOperations } from "@/shell/useOperations";
import type { ImportPreview } from "./InstallDialog";

/**
 * Packages from a bundle, the one being asked about, and what became of the
 * ones before it: one outcome per package, so the next is `outcomes.length`.
 */
type Offer = {
  packages: { manifest: string; main: string }[];
  preview?: ImportPreview;
  outcomes: PackageOutcome[];
  settle(outcomes: PackageOutcome[]): void;
};

/** A package ready to confirm, or undefined when its ID is a built-in's. */
export function previewOf(
  pkg: ImportPreview["pkg"],
  imports: readonly { id: string }[],
  host: Pick<Runtime["host"], "ids">,
): ImportPreview | undefined {
  const id = pkg.manifest.id;
  const replacing = imports.some((entry) => entry.id === id);
  return !replacing && host.ids().includes(id) ? undefined : { pkg, replacing };
}

/** The offer with one more package answered, moving on to the next. */
const advance = (offer: Offer, outcome: PackageOutcome): Offer => ({
  ...offer,
  preview: undefined,
  outcomes: [...offer.outcomes, outcome],
});

/**
 * Packages an Agent bundle offers through `ctx.shell.offerPackages`, asked
 * about one at a time. A second bundle waits for nothing and is refused
 * while one is being asked about; closing declines what is left.
 */
export function usePackageOffers(
  runtime: Pick<Runtime, "events" | "host">,
  {
    imports,
    busy,
    operate,
    install,
  }: {
    /** The imported extensions, which a package may replace. */
    imports: readonly { id: string }[];
    busy: boolean;
    operate: ShellOperations["operate"];
    /** Runs the confirmed package and saves it. */
    install: (pkg: ImportPreview["pkg"]) => Promise<unknown>;
  },
) {
  const { events, host } = runtime;
  const [offer, setOffer] = useState<Offer | null>(null);
  const offering = useRef(false);
  useEffect(() => {
    const listen = (event: Event) => {
      event.preventDefault();
      const { packages, settle } = (event as CustomEvent).detail as Pick<
        Offer,
        "packages" | "settle"
      >;
      if (offering.current)
        return settle(
          packages.map(() => ({
            outcome: "refused",
            reason: "正在确认另一组扩展",
          })),
        );
      offering.current = true;
      setOffer({ packages, outcomes: [], settle });
    };
    events.addEventListener("offer-packages", listen);
    return () => events.removeEventListener("offer-packages", listen);
  }, [events]);
  // Reads the next package's manifest; no code runs until it is confirmed.
  useEffect(() => {
    if (!offer || offer.preview) return;
    if (offer.outcomes.length >= offer.packages.length) {
      offering.current = false;
      offer.settle(offer.outcomes);
      setOffer(null);
      return;
    }
    const { manifest, main } = offer.packages[offer.outcomes.length];
    let current = true;
    readPackage([
      { path: "manifest.json", data: new Blob([manifest]) },
      { path: "main.js", data: new Blob([main]) },
    ]).then(
      (pkg) => {
        if (!current) return;
        const preview = previewOf(pkg, imports, host);
        setOffer(
          preview
            ? { ...offer, preview }
            : advance(offer, {
                outcome: "refused",
                reason: "这里已有同 ID 的内置扩展",
              }),
        );
      },
      (reason) =>
        current &&
        setOffer(
          advance(offer, {
            outcome: "refused",
            reason: errorMessage(reason),
          }),
        ),
    );
    return () => {
      current = false;
    };
  }, [offer, host, imports]);
  /** The person's answer to the package being offered, then the next. */
  function answer(choice: "install" | "skip") {
    if (!offer?.preview) return;
    const { pkg, replacing } = offer.preview;
    const next = (outcome: PackageOutcome) => setOffer(advance(offer, outcome));
    if (choice === "skip")
      return next({ outcome: replacing ? "kept" : "declined" });
    void operate(async () => {
      try {
        await install(pkg);
        next({ outcome: replacing ? "replaced" : "installed" });
      } catch (reason) {
        next({ outcome: "refused", reason: errorMessage(reason) });
        throw reason;
      }
    });
  }
  function close() {
    if (!offer || busy) return;
    offering.current = false;
    offer.settle([
      ...offer.outcomes,
      ...offer.packages.slice(offer.outcomes.length).map(() => ({
        outcome: "declined" as const,
      })),
    ]);
    setOffer(null);
  }
  return (
    offer?.preview && {
      preview: offer.preview,
      position:
        offer.packages.length > 1
          ? `${offer.outcomes.length + 1}/${offer.packages.length}`
          : "",
      answer,
      close,
    }
  );
}
