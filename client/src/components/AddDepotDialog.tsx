import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export type DepotLike = {
  id: string;
  name: string;
  address: string;
  isPrimary: boolean;
  latitude: string;
  longitude: string;
};

export function AddDepotDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (depot: DepotLike) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  function reset() {
    setName("");
    setAddress("");
    setLat("");
    setLng("");
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/depots", {
        name: name.trim(),
        address: address.trim(),
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
      });
      return res.json() as Promise<DepotLike>;
    },
    onSuccess: (depot) => {
      queryClient.invalidateQueries({ queryKey: ["/api/depots"] });
      toast({ title: "Location created", description: depot.name });
      onCreated(depot);
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const isValid =
    name.trim().length > 0 &&
    address.trim().length > 0 &&
    !isNaN(latNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    !isNaN(lngNum) &&
    lngNum >= -180 &&
    lngNum <= 180;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-sm" data-testid="dialog-add-depot">
        <DialogHeader>
          <DialogTitle>Add Starting Location</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-depot-name">Name</Label>
            <Input
              id="new-depot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. North Depot"
              data-testid="input-new-depot-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-depot-address">Address</Label>
            <Input
              id="new-depot-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, ST 00000"
              data-testid="input-new-depot-address"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-depot-lat">Latitude</Label>
              <Input
                id="new-depot-lat"
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="41.8781"
                data-testid="input-new-depot-lat"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-depot-lng">Longitude</Label>
              <Input
                id="new-depot-lng"
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-87.6298"
                data-testid="input-new-depot-lng"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tip: right-click any spot in Google Maps and copy the coordinates.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            data-testid="button-cancel-add-depot"
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!isValid || createMutation.isPending}
            data-testid="button-save-add-depot"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Add Location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
