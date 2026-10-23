import { useId, useState, type ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { cn } from "cn";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

/** Reveals only the text being entered; saved secrets are never read back. */
export function SecretInput({
  id,
  value,
  disabled,
  className,
  containerClassName,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "value"> & {
  value: string;
  containerClassName?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [visible, setVisible] = useState(false);
  // Submission/clearing ends this reveal session, including external resets.
  if (visible && (!value || disabled)) setVisible(false);
  return (
    <div className={cn("relative min-w-0", containerClassName)}>
      <Input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        value={value}
        disabled={disabled}
        className={cn("pr-10 max-md:pr-12", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 text-muted-foreground"
        aria-label={visible ? "隐藏 API Key" : "显示 API Key"}
        aria-controls={inputId}
        disabled={disabled || !value}
        onClick={() => setVisible((shown) => !shown)}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}
