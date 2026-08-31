import { useId, type ElementType, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "./cn.ts";

export type CardTone = "surface" | "canvas";
export type CardPadding = "none" | "sm" | "md";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "li";
  padding?: CardPadding;
  tone?: CardTone;
}

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
};

export function Card({
  as = "div",
  className,
  padding = "md",
  tone = "surface",
  ...props
}: CardProps) {
  const Component: ElementType = as;
  return (
    <Component
      className={cn(
        "rounded-card border border-hairline",
        tone === "surface" ? "bg-surface" : "bg-canvas",
        PADDING[padding],
        className,
      )}
      {...props}
    />
  );
}

export interface SectionCardProps extends Omit<CardProps, "as" | "aria-label" | "title"> {
  title: ReactNode;
  headingClassName?: string;
}

export function SectionCard({
  children,
  className,
  headingClassName,
  title,
  ...props
}: SectionCardProps) {
  const headingId = useId();
  return (
    <Card
      as="section"
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-3", className)}
      {...props}
    >
      <h2 id={headingId} className={cn("text-label text-primary", headingClassName)}>
        {title}
      </h2>
      {children}
    </Card>
  );
}
