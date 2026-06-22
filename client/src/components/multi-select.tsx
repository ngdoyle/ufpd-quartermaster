import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Multi-select dropdown built on Popover. Selected values render as removable
 * badges inside the trigger. Controlled via `value` (string[]) + `onChange`.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  className,
  testId = "multiselect",
}: {
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  };
  const remove = (opt: string) => onChange(value.filter((v) => v !== opt));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-auto min-h-9 w-full justify-between px-2.5 py-1.5", className)}
          data-testid={`button-${testId}`}
        >
          <span className="flex flex-1 flex-wrap items-center gap-1">
            {value.length === 0 ? (
              <span className="text-muted-foreground font-normal">{placeholder}</span>
            ) : (
              value.map((v) => (
                <Badge
                  key={v}
                  variant="secondary"
                  className="gap-1 pr-1 font-normal"
                  data-testid={`badge-${testId}-${v}`}
                >
                  {v}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${v}`}
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        remove(v);
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
        <div className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain">
            {options.map((opt) => {
              const checked = value.includes(opt);
              return (
                <button
                  type="button"
                  key={opt}
                  onClick={() => toggle(opt)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover-elevate"
                  data-testid={`option-${testId}-${opt}`}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                      checked ? "bg-primary text-primary-foreground" : "opacity-60"
                    )}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="flex-1">{opt}</span>
                </button>
              );
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
