import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

export type ButtonVariant =
  "default" | "primary" | "secondary" | "ghost" | "danger";

function buttonClassName(
  variant: ButtonVariant,
  loading: boolean,
  className?: string,
): string {
  const parts = ["button"];
  if (variant === "primary") {
    parts.push("primary");
  }
  if (variant === "secondary") {
    parts.push("button-secondary");
  }
  if (variant === "ghost") {
    parts.push("button-ghost");
  }
  if (variant === "danger") {
    parts.push("danger");
  }
  if (loading) {
    parts.push("is-loading");
  }
  if (className !== undefined && className.length > 0) {
    parts.push(className);
  }
  return parts.join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly loading?: boolean;
  readonly children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "default",
      loading = false,
      className,
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={buttonClassName(variant, loading, className)}
        disabled={disabled === true || loading}
        aria-busy={loading ? true : undefined}
        {...rest}
      >
        {loading ? (
          <span className="button-spinner" aria-hidden="true" />
        ) : null}
        <span className="button-label">{children}</span>
      </button>
    );
  },
);

export interface LinkButtonProps extends LinkProps {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
  readonly className?: string;
}

export function LinkButton({
  variant = "default",
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClassName(variant, false, className)} {...rest}>
      {children}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

export function IconButton({
  label,
  variant = "ghost",
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(
        variant,
        false,
        `icon-button ${className ?? ""}`.trim(),
      )}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  );
}
