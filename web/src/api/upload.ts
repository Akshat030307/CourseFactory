import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './http';

export interface UploadArgs {
  file: File;
  title: string;
  courseId: string | null;
  newCourseTitle: string | null;
}

export interface UploadResponse {
  lecture_id: string;
  course_id: string;
}

async function uploadLecture(args: UploadArgs): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', args.file);
  form.append('title', args.title);
  if (args.courseId) form.append('course_id', args.courseId);
  if (args.newCourseTitle) form.append('new_course_title', args.newCourseTitle);

  const res = await apiFetch('/api/v1/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.title ?? `Upload failed: ${res.status}`);
  }
  return res.json();
}

export function useUploadLecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadLecture,
    // Returning (not just firing) these promises matters: UploadPage
    // navigates to /lecture/{id} from its own onSuccess, which TanStack
    // Query only calls after this one settles — without the `return`, the
    // navigate could land before the lectures list refetch completes, and
    // AppShell would briefly render "lecture not found" for a lecture that
    // very much exists.
    onSuccess: () => {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lectures'] }),
        queryClient.invalidateQueries({ queryKey: ['courses'] }),
      ]);
    },
  });
}

export interface YoutubeUploadArgs {
  url: string;
  title: string;
  courseId: string | null;
  newCourseTitle: string | null;
}

async function uploadFromYoutube(args: YoutubeUploadArgs): Promise<UploadResponse> {
  const res = await apiFetch('/api/v1/upload/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: args.url,
      title: args.title,
      course_id: args.courseId,
      new_course_title: args.newCourseTitle,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.title ?? body?.detail ?? `Upload failed: ${res.status}`);
  }
  return res.json();
}

// Same fast-return shape as useUploadLecture: the response comes back as
// soon as the course/lecture rows exist and the download+ingest subprocess
// is spawned — it does not wait for the download itself to finish.
export function useUploadFromYoutube() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadFromYoutube,
    onSuccess: () => {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lectures'] }),
        queryClient.invalidateQueries({ queryKey: ['courses'] }),
      ]);
    },
  });
}
