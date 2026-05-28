import { StaffRelationsInbox } from '../StaffRelationsInbox';

export function SyndicRelationsInboxPage() {
  return (
    <StaffRelationsInbox
      channel="syndic"
      backTo="/app/sindico"
      inboxPath="/app/sindico/chats"
      title="Chats · Síndico"
    />
  );
}
