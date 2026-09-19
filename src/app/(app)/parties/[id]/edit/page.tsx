import { redirect } from "next/navigation";

export default function EditPartyPage({ params }: { params: { id: string } }) {
  redirect(`/parties?id=${params.id}`);
}
