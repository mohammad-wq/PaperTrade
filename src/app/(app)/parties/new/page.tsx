import { redirect } from "next/navigation";

export default function NewPartyPage() {
  redirect("/parties?action=new");
}
