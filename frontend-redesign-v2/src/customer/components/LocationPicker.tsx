import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, ChevronDown, Check, Search, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveSelectedCity } from "@/lib/cpse/cityPreference";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { useDirectory, useSelectedCity } from "../hooks";

/**
 * City selector. Opens only from its own button: a popover on desktop, a
 * bottom sheet on phones. Current choice first, then every city that has shops,
 * each with its shop count, filterable by typing.
 */
export function LocationPicker({ compact = false }: { compact?: boolean }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const city = useSelectedCity();

  const trigger = (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      className={cn(
        "flex min-w-0 max-w-full items-center gap-2 rounded-full border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-card",
        open && "border-border bg-card",
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <MapPin className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 overflow-hidden leading-tight">
        {!compact ? <span className="block truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shopping in</span> : null}
        <span className="flex items-center gap-1 font-bold">
          <span className="truncate">{city || "All cities"}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </span>
      </span>
      <span className="sr-only">— change city</span>
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[85vh] bg-popover">
            <DrawerHeader className="text-left">
              <DrawerTitle className="font-display text-2xl">Where are you shopping?</DrawerTitle>
              <DrawerDescription>Shops and offers update for the city you pick.</DrawerDescription>
            </DrawerHeader>
            <div className="px-4 pb-6">
              <CityList current={city} onChoose={() => setOpen(false)} />
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="z-[70] w-80 rounded-2xl border-border-strong/30 bg-popover p-3 shadow-pop">
        <p className="px-1 pb-2 font-display text-lg font-bold">Where are you shopping?</p>
        <CityList current={city} onChoose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function CityList({ current, onChoose }: { current: string; onChoose: () => void }) {
  const directory = useDirectory();
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const store of directory.data?.stores ?? []) {
      const name = store.location?.city?.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [directory.data]);

  const total = directory.data?.stores?.length ?? 0;
  const visible = cities.filter(([name]) => name.toLowerCase().includes(filter.trim().toLowerCase()));

  const choose = (value: string) => {
    saveSelectedCity(value);
    onChoose();
  };

  return (
    <div>
      <div className="mb-2 flex h-10 items-center gap-2 rounded-xl border bg-card px-3">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a city"
          aria-label="Find a city"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <ul className="max-h-72 space-y-0.5 overflow-y-auto" aria-label="Cities">
        {!filter ? (
          <li>
            <CityOption label="All cities" detail={`${total} shops`} selected={!current} icon={<Globe2 className="h-4 w-4" />} onClick={() => choose("")} />
          </li>
        ) : null}
        {directory.isLoading ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">Loading cities…</li>
        ) : visible.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No shops in a city called “{filter}” yet.</li>
        ) : (
          visible.map(([name, count]) => (
            <li key={name}>
              <CityOption
                label={name}
                detail={`${count} ${count === 1 ? "shop" : "shops"}`}
                selected={current.localeCompare(name, undefined, { sensitivity: "accent" }) === 0}
                icon={<MapPin className="h-4 w-4" />}
                onClick={() => choose(name)}
              />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function CityOption({ label, detail, selected, icon, onClick }: { label: string; detail: string; selected: boolean; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-accent",
        selected && "bg-primary-soft",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      {selected ? <Check className="h-4 w-4 text-success" aria-label="Selected" /> : null}
    </button>
  );
}
