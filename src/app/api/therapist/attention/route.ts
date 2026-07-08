import { listAttentionItems } from "@/lib/therapist-access";
import { requireTherapist } from "../_lib/require-therapist";

export async function GET(): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const items = await listAttentionItems(authResult.therapistId);
  return Response.json(items);
}
