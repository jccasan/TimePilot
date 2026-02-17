import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";

interface GooglePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
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

function parseAddressComponents(components: any[]): Omit<ParsedAddress, "latitude" | "longitude"> {
  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";
  let zipCode = "";

  for (const comp of components) {
    const types = comp.types || [];
    if (types.includes("street_number")) streetNumber = comp.long_name;
    else if (types.includes("route")) route = comp.long_name;
    else if (types.includes("locality")) city = comp.long_name;
    else if (types.includes("sublocality_level_1") && !city) city = comp.long_name;
    else if (types.includes("administrative_area_level_1")) state = comp.short_name;
    else if (types.includes("postal_code")) zipCode = comp.long_name;
  }

  return {
    streetAddress: [streetNumber, route].filter(Boolean).join(" "),
    city,
    state,
    zipCode,
  };
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Start typing an address...",
  "data-testid": testId,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<GooglePrediction[]>([]);
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
        const data = await res.json();
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

  async function handleSelect(prediction: GooglePrediction) {
    suppressFetchRef.current = true;
    onChange(prediction.structured_formatting.main_text);
    setIsOpen(false);
    setSuggestions([]);

    try {
      const res = await fetch(`/api/geocode/place-details?placeId=${encodeURIComponent(prediction.place_id)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const details = await res.json();
        if (details) {
          const parsed = parseAddressComponents(details.address_components || []);
          const lat = details.geometry?.location?.lat?.toString() || "";
          const lng = details.geometry?.location?.lng?.toString() || "";
          onSelect({
            ...parsed,
            latitude: lat,
            longitude: lng,
          });
          if (parsed.streetAddress) {
            suppressFetchRef.current = true;
            onChange(parsed.streetAddress);
          }
        }
      }
    } catch {
      onSelect({
        streetAddress: prediction.structured_formatting.main_text,
        city: "",
        state: "",
        zipCode: "",
        latitude: "",
        longitude: "",
      });
    }
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
              key={s.place_id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm cursor-pointer hover-elevate ${
                i === highlightIndex ? "bg-accent" : ""
              }`}
              onClick={() => handleSelect(s)}
              data-testid={`address-suggestion-${i}`}
            >
              <p className="font-medium truncate">{s.structured_formatting.main_text}</p>
              <p className="text-xs text-muted-foreground truncate">{s.structured_formatting.secondary_text}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
