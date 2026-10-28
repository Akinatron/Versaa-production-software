import { redirect } from "next/navigation";

/** Old address of an item's stock. The item card (/items/[id]) now holds stock and suppliers together. */
export default async function ItemStockRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { itemId } = await params;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const one of [v ?? []].flat()) query.append(k, one);
  query.set("tab", "stock");
  redirect(`/items/${encodeURIComponent(itemId)}?${query}`);
}
