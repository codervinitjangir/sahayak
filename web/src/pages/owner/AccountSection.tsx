import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../services/api';
import { usersService } from '../../services/users.service';
import { useAuth } from '../../app/AuthProvider';

/** Owner self-service on web: edit profile, download data, delete account (G8 / G10, ADR-025). */
export const AccountSection: React.FC = () => {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const me = useQuery({ queryKey: ['owner', 'me'], queryFn: () => usersService.getMe() });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => usersService.updateMe({ name: name.trim(), email: email.trim() || null }),
    onSuccess: (p) => {
      qc.setQueryData(['owner', 'me'], p);
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => usersService.deleteMe(),
    onSuccess: () => logout(),
  });

  const openEdit = () => {
    setName(me.data?.name ?? '');
    setEmail(me.data?.email ?? '');
    save.reset();
    setEditing(true);
  };

  const download = async () => {
    setExportError(null);
    try {
      const data = await usersService.exportMe();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sahayak-my-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Released later: revoking straight after click() can cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      const reason = err instanceof Error && err.message ? ` (${err.message})` : '';
      setExportError(`Could not prepare your data. Try again.${reason}`);
    }
  };

  const saveError = save.error instanceof ApiError && save.error.code === 'USER_ALREADY_EXISTS'
    ? 'Another account already uses this email address.'
    : save.isError ? 'Could not save. Try again.' : null;
  const deleteError = remove.error instanceof ApiError && remove.error.code === 'ACCOUNT_HAS_ACTIVE_JOB'
    ? 'Finish or cancel your active request first.'
    : remove.isError ? 'Could not delete your account. Try again.' : null;

  return (
    <section aria-labelledby="account-heading" className="space-y-3">
      <h2 id="account-heading" className="text-lg font-bold text-ink">Your account</h2>
      <div className="rounded-card border border-line bg-white p-4 space-y-3">
        {me.data ? (
          <div>
            <p className="font-semibold text-ink">{me.data.name}</p>
            <p className="text-sm text-ink-soft">{me.data.phone}{me.data.email ? ` · ${me.data.email}` : ''}</p>
          </div>
        ) : me.isError ? (
          <p className="text-sm text-ink-soft">Could not load your profile.</p>
        ) : (
          <p className="text-sm text-ink-soft">Loading…</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={openEdit} disabled={!me.data}>
            <Pencil className="h-4 w-4" aria-hidden="true" /> Edit profile
          </Button>
          <Button size="sm" variant="outline" onClick={() => void download()}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download my data
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { remove.reset(); setDeleting(true); }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account
          </Button>
        </div>
        {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}
      </div>

      {editing && (
        <Modal isOpen onClose={() => setEditing(false)} title="Edit profile" maxWidth="sm"
          description="Your phone number is how you sign in, so it cannot be changed here.">
          <label className="block text-sm font-semibold text-ink-soft" htmlFor="me-name">Name</label>
          <input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100}
            className="mt-1 w-full rounded-control border border-line px-3 py-2" />
          <label className="mt-3 block text-sm font-semibold text-ink-soft" htmlFor="me-email">Email (optional)</label>
          <input id="me-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={150}
            className="mt-1 w-full rounded-control border border-line px-3 py-2" />
          {saveError && <p role="alert" className="mt-2 text-sm text-red-700">{saveError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} isLoading={save.isPending} disabled={!name.trim()}>Save</Button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal isOpen onClose={() => setDeleting(false)} title="Delete your account?" maxWidth="sm"
          description="Your name, phone, email, vehicles and notifications are erased and you are signed out. Past jobs stay on record without your details. This cannot be undone.">
          {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(false)}>Keep my account</Button>
            <Button variant="danger" onClick={() => remove.mutate()} isLoading={remove.isPending}>Delete account</Button>
          </div>
        </Modal>
      )}
    </section>
  );
};
