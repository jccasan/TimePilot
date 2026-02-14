import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ApiKey } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Plus, Key, Copy, Trash2 } from "lucide-react";

const availableScopes = [
  "contacts.read",
  "contacts.write",
  "visits.read",
  "visits.write",
  "invoices.read",
];

const keyFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  scopes: z.array(z.string()).min(1, "Select at least one scope"),
});

type KeyFormValues = z.infer<typeof keyFormSchema>;

export default function ApiKeys() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [rawKeyDialogOpen, setRawKeyDialogOpen] = useState(false);

  const { data: apiKeys, isLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/api-keys"],
  });

  const form = useForm<KeyFormValues>({
    resolver: zodResolver(keyFormSchema),
    defaultValues: {
      name: "",
      scopes: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: KeyFormValues) => {
      const res = await apiRequest("POST", "/api/api-keys", data);
      return res.json();
    },
    onSuccess: (data: { rawKey: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setDialogOpen(false);
      form.reset();
      setRawKey(data.rawKey);
      setRawKeyDialogOpen(true);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "Deleted", description: "API key deleted." });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "API key copied to clipboard." });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-api-keys-heading">API Keys</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-api-key">
              <Plus className="mr-1 h-4 w-4" /> Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Key Name</FormLabel>
                    <FormControl><Input {...field} data-testid="input-key-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="scopes" render={() => (
                  <FormItem>
                    <FormLabel>Scopes</FormLabel>
                    <div className="space-y-2">
                      {availableScopes.map((scope) => (
                        <FormField
                          key={scope}
                          control={form.control}
                          name="scopes"
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(scope)}
                                  onCheckedChange={(checked) => {
                                    const current = field.value || [];
                                    if (checked) {
                                      field.onChange([...current, scope]);
                                    } else {
                                      field.onChange(current.filter((s: string) => s !== scope));
                                    }
                                  }}
                                  data-testid={`checkbox-scope-${scope}`}
                                />
                              </FormControl>
                              <span className="text-sm font-mono">{scope}</span>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-api-key">
                  {createMutation.isPending ? "Creating..." : "Create Key"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={rawKeyDialogOpen} onOpenChange={setRawKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Copy this key now. You will not be able to see it again.
          </p>
          <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
            <code className="text-sm flex-1 break-all" data-testid="text-raw-key">{rawKey}</code>
            <Button variant="ghost" size="icon" onClick={() => rawKey && copyToClipboard(rawKey)} data-testid="button-copy-key">
              <Copy />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : apiKeys && apiKeys.length > 0 ? (
        <div className="space-y-3">
          {apiKeys.map((key) => (
            <Card key={key.id} data-testid={`card-api-key-${key.id}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="flex items-center gap-3">
                  <Key className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium" data-testid={`text-key-name-${key.id}`}>{key.name}</p>
                    <p className="text-sm text-muted-foreground font-mono" data-testid={`text-key-prefix-${key.id}`}>
                      {key.keyPrefix}...
                    </p>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="text-xs text-muted-foreground">
                        Created: {new Date(key.createdAt).toLocaleDateString()}
                      </span>
                      {key.lastUsedAt && (
                        <span className="text-xs text-muted-foreground">
                          | Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={key.isActive ? "default" : "secondary"} data-testid={`badge-key-status-${key.id}`}>
                    {key.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(key.id)}
                    data-testid={`button-delete-key-${key.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-api-keys">
            No API keys. Create one to access the API programmatically.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
