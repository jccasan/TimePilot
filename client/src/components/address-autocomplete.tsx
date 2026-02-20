import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";

interface MapboxSuggestion {
  id: string;
  full_address: string;
  name: string;
  place_formatted: string;
  coordinates: { longitude: number; latitude: number } | null;
  city: string;
  state: string;
  zipCode: string;
}

interface ParsedAddress {
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  latitude: string;
  longitude: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: ParsedAddress) => void;
  placeholder?: string;
  "data-testid"?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Start typing an address...",
  "data-testid": testId,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<MapboxSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressFetchRef = useRef(false);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/geocode/autocomplete?q=${encodeURIComponent(query)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data: MapboxSuggestion[] = await res.json();
        setSuggestions(data);
        setIsOpen(data.length > 0);
        setHighlightIndex(-1);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (suppressFetchRef.current) {
      suppressFetchRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, fetchSuggestions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(suggestion: MapboxSuggestion) {
    suppressFetchRef.current = true;
    const streetAddress = suggestion.name || "";

    onChange(streetAddress || suggestion.full_address);
    setIsOpen(false);
    setSuggestions([]);

    onSelect({
      streetAddress,
      city: suggestion.city || "",
      state: suggestion.state || "",
      zipCode: suggestion.zipCode || "",
      latitude: suggestion.coordinates?.latitude?.toString() || "",
      longitude: suggestion.coordinates?.longitude?.toString() || "",
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setIsOpen(true); }}
          placeholder={placeholder}
          className="pl-10"
          data-testid={testId}
          autoComplete="off"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto" data-testid="address-suggestions-list">
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm cursor-pointer hover-elevate ${
                i === highlightIndex ? "bg-accent" : ""
              }`}
              onClick={() => handleSelect(s)}
              data-testid={`address-suggestion-${i}`}
            >
              <p className="font-medium truncate">{s.name}</p>
              <p className="text-xs text-muted-foreground truncate">{s.place_formatted}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
