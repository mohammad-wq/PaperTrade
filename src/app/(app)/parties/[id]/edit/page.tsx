import { PartyEditor } from "@/components/parties/party-editor";

export default async function EditPartyPage({ params }: { params: { id: string } }) {
  return <PartyEditor partyId={params.id} />;
}
