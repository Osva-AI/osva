import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

function describedBy(hintId?: string, errorId?: string): string | undefined {
  const ids = [hintId, errorId].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  return ids.length > 0 ? ids.join(" ") : undefined;
}

interface FieldShellProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  readonly required?: boolean;
  readonly children: ReactNode;
}

export function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  optional,
  required,
  children,
}: FieldShellProps) {
  const hintId = hint !== undefined ? `${htmlFor}-hint` : undefined;
  const errorId = error !== undefined ? `${htmlFor}-error` : undefined;

  return (
    <div className={`field${error !== undefined ? " is-invalid" : ""}`}>
      <label htmlFor={htmlFor} className="field-label">
        {label}
        {required ? (
          <span className="field-badge field-badge-required">Required</span>
        ) : null}
        {optional ? (
          <span className="field-badge field-badge-optional">Optional</span>
        ) : null}
      </label>
      {hint !== undefined ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
      {children}
      {error !== undefined ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id"
> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  readonly required?: boolean;
}

export function TextField({
  id,
  label,
  hint,
  error,
  optional,
  required,
  className,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint !== undefined ? `${fieldId}-hint` : undefined;
  const errorId = error !== undefined ? `${fieldId}-error` : undefined;

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      hint={hint}
      error={error}
      optional={optional}
      required={required}
    >
      <input
        id={fieldId}
        className={`ui-control${className !== undefined ? ` ${className}` : ""}`}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy(hintId, errorId)}
        required={required}
        {...inputProps}
      />
    </FieldShell>
  );
}

export interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id"
> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  readonly required?: boolean;
  readonly children: ReactNode;
}

export function SelectField({
  id,
  label,
  hint,
  error,
  optional,
  required,
  className,
  children,
  ...selectProps
}: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint !== undefined ? `${fieldId}-hint` : undefined;
  const errorId = error !== undefined ? `${fieldId}-error` : undefined;

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      hint={hint}
      error={error}
      optional={optional}
      required={required}
    >
      <select
        id={fieldId}
        className={`ui-control${className !== undefined ? ` ${className}` : ""}`}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy(hintId, errorId)}
        required={required}
        {...selectProps}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  readonly required?: boolean;
}

export function TextAreaField({
  id,
  label,
  hint,
  error,
  optional,
  required,
  className,
  ...textareaProps
}: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint !== undefined ? `${fieldId}-hint` : undefined;
  const errorId = error !== undefined ? `${fieldId}-error` : undefined;

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      hint={hint}
      error={error}
      optional={optional}
      required={required}
    >
      <textarea
        id={fieldId}
        className={`ui-control ui-control-textarea${className !== undefined ? ` ${className}` : ""}`}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy(hintId, errorId)}
        required={required}
        {...textareaProps}
      />
    </FieldShell>
  );
}
