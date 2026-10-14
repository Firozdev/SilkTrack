import { ActionForm } from "@/components/action-form";
import { Attachments, Card } from "@/components/ui";
import { portalUploadAction } from "../actions";
import type { Dict } from "../i18n";

type File = { id: string; fileName: string; mimeType: string; uploadedByAccountId: string | null };

/** The customer's files on a record, plus an upload form when allowed. */
export function FilesCard({ t, files, kind, id, canUpload }: { t: Dict; files: File[]; kind: "order" | "shipping"; id: string; canUpload: boolean }) {
  if (!files.length && !canUpload) return null;
  return (
    <Card title={t.myFiles}>
      <Attachments items={files} base="/portal/files" customerTag={null} />
      {canUpload && (
        <ActionForm action={portalUploadAction} submitLabel={t.upload} inline className="mt-3" resetOnSuccess>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <label className="block w-full text-xs text-gray-500">{t.filesHint}</label>
          <input type="file" name="photos" accept="image/*,application/pdf" multiple required className="text-sm" />
        </ActionForm>
      )}
    </Card>
  );
}
