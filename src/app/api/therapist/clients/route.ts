import { getActiveLinksForTherapist } from "@/lib/therapist-links";
import { requireTherapist } from "../_lib/require-therapist";

export async function GET(): Promise<Response> {
  const authResult = await requireTherapist();
  if (!authResult.ok) return authResult.response;

  const clients = await getActiveLinksForTherapist(authResult.therapistId);
  return Response.json(clients);
}
