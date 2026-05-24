import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, Users, Home, FileText, MapPin } from "lucide-react";
import { authFetch } from "@/lib/queryClient";

interface SearchResult {
  id: number;
  type: "contact" | "property" | "invoice" | "route";
  title: string;
  subtitle?: string;
}

interface GroupedResults {
  contacts: SearchResult[];
  properties: SearchResult[];
  invoices: SearchResult[];
  routes: SearchResult[];
}

const typeConfig = {
  contacts: { icon: Users, label: "Contacts and Leads", path: "/contacts" },
  properties: { icon: Home, label: "Properties", path: "/contacts" },
  invoices: { icon: FileText, label: "Invoices", path: "/invoices" },
  routes: { icon: MapPin, label: "Routes", path: "/routes" },
} as const;

function getDetailPath(result: SearchResult): string {
  switch (result.type) {
    case "contact":
      return `/contacts/${result.id}`;
    case "property":
      return `/contacts/${result.id}`;
    case "invoice":
      return `/invoices/${result.id}`;
    case "route":
      return `/routes/${result.id}`;
    default:
      return "/";
  }
}

function groupResults(results: SearchResult[]): GroupedResults {
  const grouped: GroupedResults = { contacts: [], properties: [], invoices: [], routes: [] };
  for (const r of results) {
    const key =
      r.type === "contact"
        ? "contacts"
        : r.type === "property"
          ? "properties"
          : r.type === "invoice"
            ? "invoices"
            : "routes";
    grouped[key].push(r);
  }
  return grouped;
}

export function GlobalSearch() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatResults = results;

  const fetchResults = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await authFetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setIsOpen(true);
      }
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => fetchResults(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchResults]);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectResult = useCallback(
    (result: SearchResult) => {
      setIsOpen(false);
      setQuery("");
      setResults([]);
      setLocation(getDetailPath(result));
    },
    [setLocation]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!isOpen || flatResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < flatResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : flatResults.length - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < flatResults.length) {
      e.preventDefault();
      selectResult(flatResults[activeIndex]);
    }
  }

  const grouped = groupResults(flatResults);
  let runningIndex = 0;

  return (
    <div ref={containerRef} className="relative w-full" data-testid="global-search-container">
      <div className="relative flex items-center" data-testid="global-search-input-wrapper">
        <Search className="absolute left-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-16 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid="input-global-search"
        />
        <kbd
          className="absolute right-2 pointer-events-none inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          data-testid="text-search-shortcut"
        >
          {navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}K
        </kbd>
      </div>

      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
          data-testid="dropdown-search-results"
        >
          {isLoading && (
            <div
              className="px-3 py-2 text-sm text-muted-foreground"
              data-testid="text-search-loading"
            >
              Searching...
            </div>
          )}
          {!isLoading && flatResults.length === 0 && query.trim() && (
            <div
              className="px-3 py-2 text-sm text-muted-foreground"
              data-testid="text-search-no-results"
            >
              No results found
            </div>
          )}
          {!isLoading &&
            (Object.keys(typeConfig) as Array<keyof typeof typeConfig>).map((groupKey) => {
              const items = grouped[groupKey];
              if (items.length === 0) return null;
              const config = typeConfig[groupKey];
              const Icon = config.icon;
              const groupStartIndex = runningIndex;
              runningIndex += items.length;
              return (
                <div key={groupKey} data-testid={`search-group-${groupKey}`}>
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                    data-testid={`text-search-group-label-${groupKey}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {config.label}
                  </div>
                  {items.map((result, i) => {
                    const flatIndex = groupStartIndex + i;
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover-elevate ${
                          flatIndex === activeIndex ? "bg-accent text-accent-foreground" : ""
                        }`}
                        onClick={() => selectResult(result)}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        data-testid={`search-result-${result.type}-${result.id}`}
                      >
                        <span
                          className="font-medium truncate"
                          data-testid={`text-search-result-title-${result.type}-${result.id}`}
                        >
                          {result.title}
                        </span>
                        {result.subtitle && (
                          <span
                            className="text-xs text-muted-foreground truncate"
                            data-testid={`text-search-result-subtitle-${result.type}-${result.id}`}
                          >
                            {result.subtitle}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
