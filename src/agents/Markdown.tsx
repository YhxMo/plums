import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "cn";
import { isOpenableLink } from "@modules/sdk/links";
import { copyText } from "./clipboard";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";

/** Block spacing and element styles; Tailwind's reset leaves them bare. */
const prose = cn(
  "min-w-0 [&>*+*]:mt-2 [&_li+li]:mt-0.5 [&_li>:is(ul,ol)]:mt-0.5",
  "[&_ol]:list-decimal [&_ul]:list-disc [&_:is(ul,ol)]:pl-5",
  "[&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_h1]:text-base [&_h2]:text-[15px]",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:font-mono [&_code]:text-[0.92em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-chat [&_:not(pre)>code]:px-1",
  "[&_hr]:border-border [&_table]:border-collapse [&_th]:font-semibold [&_:is(th,td)]:border [&_:is(th,td)]:border-border [&_:is(th,td)]:px-2 [&_:is(th,td)]:py-1",
);

type Actions = {
  onOpenLink: (url: string) => void;
  onError: (message: string) => void;
};
/** Handlers for the stable element components below. */
const ActionsContext = createContext<Actions>({
  onOpenLink: () => {},
  onError: () => {},
});

/** A fenced block with a copy button over its corner. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const { onError } = useContext(ActionsContext);
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const label = copied ? "已复制" : "复制代码";
  return (
    <div className="group/code relative">
      <pre
        ref={pre}
        className="overflow-x-auto rounded-lg bg-chat px-3 py-2 text-[13px] leading-5"
      >
        {children}
      </pre>
      <Tooltip label={label}>
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-1 right-1 text-muted-foreground opacity-0 group-hover/code:opacity-100 hover:text-foreground focus-visible:opacity-100 max-md:opacity-100 [&_svg:not([class*='size-'])]:size-3.5"
          aria-label={label}
          onClick={() =>
            copyText(pre.current?.textContent?.replace(/\n$/, "") ?? "").then(
              () => setCopied(true),
              (error: Error) => onError(error.message),
            )
          }
        >
          {copied ? <CheckIcon className="text-running" /> : <CopyIcon />}
        </Button>
      </Tooltip>
    </div>
  );
}

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  const { onOpenLink } = useContext(ActionsContext);
  if (!isOpenableLink(href)) return <span>{children}</span>;
  return (
    <a
      href={href}
      title={href}
      className="text-brand-text underline underline-offset-2"
      onClick={(event) => {
        // The app's own window never navigates away.
        event.preventDefault();
        onOpenLink(href);
      }}
    >
      {children}
    </a>
  );
}

/** Defined once, so a new render keeps the elements and their state. */
const components: Components = {
  a: Link,
  img: ({ alt }) => (
    <span className="text-muted-foreground">
      {alt ? `[图片：${alt}]` : "[图片]"}
    </span>
  ),
  pre: CodeBlock,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};
const plugins = [remarkGfm, remarkBreaks];

/**
 * A reply as GitHub-flavoured Markdown with line breaks kept. Raw HTML is
 * not rendered, pictures show their description, and only https links are
 * links, which the host opens in the browser.
 */
export function Markdown({
  text,
  onOpenLink,
  onError,
}: Actions & { text: string }) {
  return (
    <ActionsContext value={{ onOpenLink, onError }}>
      <div className={prose}>
        <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml>
          {text}
        </ReactMarkdown>
      </div>
    </ActionsContext>
  );
}
