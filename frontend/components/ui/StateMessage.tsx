import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

export type StateMessageState = "loading" | "empty" | "error" | "unavailable" | "success";

export interface StateMessageProps extends Omit<HTMLAttributes<HTMLDivElement>,
  "aria-atomic" | "aria-busy" | "aria-live" | "role" | "title"> {
  action?: ReactNode;
  announce?: "on" | "off";
  state: StateMessageState;
  title: ReactNode;
}

const MARKS: Record<StateMessageState, string> = {
  loading: "…", empty: "○", error: "!", unavailable: "—", success: "✓",
};

export const StateMessage = forwardRef<HTMLDivElement, StateMessageProps>(function StateMessage(
  { action, announce = "on", children, className = "", state, title, ...props }, ref,
) {
  const urgent = state === "error";
  const liveProps = announce === "off" ? {} : {
    role: urgent ? "alert" : "status",
    "aria-live": urgent ? "assertive" : "polite",
  } as const;

  return (
    <div {...props} ref={ref} className={`ui-state-message ui-state-message--${state} ${className}`.trim()}>
      <div {...liveProps} aria-atomic="true" aria-busy={state === "loading"} data-state={state}
        className="ui-state-message__live">
        <span className="ui-state-message__mark" aria-hidden="true">{MARKS[state]}</span>
        <div className="ui-state-message__body">
          <strong className="ui-state-message__title">{title}</strong>
          {children ? <div className="ui-state-message__detail">{children}</div> : null}
        </div>
      </div>
      {action ? <div className="ui-state-message__action">{action}</div> : null}
    </div>
  );
});
