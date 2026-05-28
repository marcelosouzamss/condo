import { StaffRelationsInbox } from '../StaffRelationsInbox';

export function AdministrationRelationsInboxPage() {
  return (
    <StaffRelationsInbox
      channel="administration"
      backTo="/app/administracao"
      inboxPath="/app/administracao/chats"
      title="Chats · Administração"
    />
  );
}
