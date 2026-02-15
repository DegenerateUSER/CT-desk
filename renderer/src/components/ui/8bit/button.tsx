import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

import { Button as ShadcnButton } from "@/components/ui/button";

import "@/components/ui/8bit/styles/retro.css";

export const buttonVariants = cva("", {
  variants: {
    font: {
      normal: "",
      retro: "retro",
    },
    variant: {
      default: "bg-foreground",
      destructive: "bg-foreground",
      outline: "bg-foreground",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
    },
    size: {
      default: "h-9 px-4 py-2 has-[>svg]:px-3",
      sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
      lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
      icon: "size-9",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface BitButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

function Button({ children, asChild, ...props }: BitButtonProps) {
  const { variant, size, className, font } = props;

  const hasBorder =
    variant !== "ghost" && variant !== "link" && size !== "icon";

  return (
    <ShadcnButton
      {...props}
      className={cn(
        "rounded-none active:translate-y-0.5 transition-transform relative inline-flex items-center justify-center gap-0.5 border-none m-0.5",
        size === "icon" && "mx-0.5 my-0",
        font !== "normal" && "retro",
        className,
      )}
      size={size}
      variant={variant}
      asChild={asChild}
    >
      {asChild ? (
        <span className="relative inline-flex items-center justify-center gap-0.5">
          {children}

          {variant !== "ghost" && variant !== "link" && size !== "icon" && (
            <>
              {/* Pixelated border */}
              <div className="absolute -top-0.5 w-1/2 left-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute -top-0.5 w-1/2 right-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute -bottom-0.5 w-1/2 left-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute -bottom-0.5 w-1/2 right-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0 left-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0 right-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute bottom-0 left-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute bottom-0 right-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0.5 -left-0.5 h-[calc(100%-4px)] w-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0.5 -right-0.5 h-[calc(100%-4px)] w-0.5 bg-foreground dark:bg-ring" />
              {variant !== "outline" && (
                <>
                  {/* Top shadow */}
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-foreground/20" />
                  <div className="absolute top-0.5 left-0 w-1 h-0.5 bg-foreground/20" />

                  {/* Bottom shadow */}
                  <div className="absolute bottom-0 left-0 w-full h-0.5 bg-foreground/20" />
                  <div className="absolute bottom-0.5 right-0 w-1 h-0.5 bg-foreground/20" />
                </>
              )}
            </>
          )}

          {size === "icon" && (
            <>
              <div className="absolute top-0 left-0 w-full h-[3px] md:h-0.5 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute bottom-0 w-full h-[3px] md:h-0.5 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute top-0.5 -left-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute bottom-0.5 -left-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute top-0.5 -right-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute bottom-0.5 -right-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
            </>
          )}
        </span>
      ) : (
        <>
          {children}

          {variant !== "ghost" && variant !== "link" && size !== "icon" && (
            <>
              {/* Pixelated border */}
              <div className="absolute -top-0.5 w-1/2 left-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute -top-0.5 w-1/2 right-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute -bottom-0.5 w-1/2 left-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute -bottom-0.5 w-1/2 right-0.5 h-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0 left-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0 right-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute bottom-0 left-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute bottom-0 right-0 size-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0.5 -left-0.5 h-[calc(100%-4px)] w-0.5 bg-foreground dark:bg-ring" />
              <div className="absolute top-0.5 -right-0.5 h-[calc(100%-4px)] w-0.5 bg-foreground dark:bg-ring" />
              {variant !== "outline" && (
                <>
                  {/* Top shadow */}
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-foreground/20" />
                  <div className="absolute top-0.5 left-0 w-1 h-0.5 bg-foreground/20" />

                  {/* Bottom shadow */}
                  <div className="absolute bottom-0 left-0 w-full h-0.5 bg-foreground/20" />
                  <div className="absolute bottom-0.5 right-0 w-1 h-0.5 bg-foreground/20" />
                </>
              )}
            </>
          )}

          {size === "icon" && (
            <>
              <div className="absolute top-0 left-0 w-full h-[3px] md:h-0.5 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute bottom-0 w-full h-[3px] md:h-0.5 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute top-0.5 -left-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute bottom-0.5 -left-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute top-0.5 -right-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
              <div className="absolute bottom-0.5 -right-0.5 w-[3px] md:w-0.5 h-1/2 bg-foreground dark:bg-ring pointer-events-none" />
            </>
          )}
        </>
      )}
    </ShadcnButton>
  );
}

export { Button };
