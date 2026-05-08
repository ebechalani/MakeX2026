'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { quizForRulesKey, rulesKeyForCategory, type Quiz, type Question } from '@/lib/questionnaires';
import type { Category, Passation, QuestionnaireResponse } from '@/lib/types';

type Props = {
  academyId: string;
  academyName: string;
  passations: Passation[];
  categories: Category[];
};

export default function QuizTab({ academyId, academyName, passations, categories }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [responses, setResponses] = useState<QuestionnaireResponse[]>([]);
  const [openQuiz, setOpenQuiz] = useState<string | null>(null);

  // Quizzes the academy needs to take, derived from their categories
  const myQuizzes = useMemo(() => {
    const keys = new Set<string>();
    for (const p of passations) {
      const k = rulesKeyForCategory(categories.find(c => c.id === p.category_id)?.name || '');
      if (k) keys.add(k);
    }
    return Array.from(keys)
      .map(k => quizForRulesKey(k))
      .filter((q): q is Quiz => !!q)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [passations, categories]);

  const load = async () => {
    const { data } = await supabase.from('questionnaire_responses').select('*').eq('academy_id', academyId);
    if (data) setResponses(data as QuestionnaireResponse[]);
  };
  useEffect(() => { load(); }, [academyId]); // eslint-disable-line react-hooks/exhaustive-deps

  function responseFor(rk: string) {
    return responses.find(r => r.rules_key === rk);
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <strong>Knowledge check:</strong> for each category your academy is competing in, complete the short quiz to confirm the rules are clear. Auto-graded — your score appears immediately. You can re-open the quiz anytime to review the questions and your answers.
      </div>

      {myQuizzes.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
          You currently have no students assigned to any quizzed category.
        </div>
      )}

      {myQuizzes.map(quiz => {
        const resp = responseFor(quiz.rulesKey);
        const isOpen = openQuiz === quiz.rulesKey;
        const passed = resp ? resp.score >= quiz.passMark : false;
        return (
          <div key={quiz.rulesKey} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-800">{quiz.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{quiz.subtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                {resp ? (
                  <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${passed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                    {passed ? '✓' : '⚠'} {resp.score}/{resp.total} · by {resp.responder_name} · {new Date(resp.submitted_at).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-full">
                    Not yet completed
                  </span>
                )}
                <button onClick={() => setOpenQuiz(isOpen ? null : quiz.rulesKey)}
                  className="text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg">
                  {isOpen ? 'Close' : (resp ? 'Review / Retake' : 'Start Quiz')}
                </button>
              </div>
            </div>
            {isOpen && (
              <QuizPanel
                quiz={quiz}
                academyId={academyId}
                academyName={academyName}
                existing={resp}
                onSubmitted={() => { load(); setOpenQuiz(null); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuizPanel({
  quiz, academyId, academyName, existing, onSubmitted,
}: {
  quiz: Quiz;
  academyId: string;
  academyName: string;
  existing?: QuestionnaireResponse;
  onSubmitted: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [answers, setAnswers] = useState<Record<string, number>>(existing?.answers || {});
  const [responderName, setResponderName] = useState(existing?.responder_name || '');
  const [responderRole, setResponderRole] = useState(existing?.responder_role || 'Coach');
  const [submitted, setSubmitted] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function pick(qid: string, ix: number) {
    if (submitted) return;
    setAnswers(a => ({ ...a, [qid]: ix }));
  }

  function score(): { score: number; total: number } {
    let s = 0;
    for (const q of quiz.questions) if (answers[q.id] === q.correct) s++;
    return { score: s, total: quiz.questions.length };
  }

  async function submit() {
    setErr('');
    if (!responderName.trim()) { setErr('Please enter your name.'); return; }
    if (Object.keys(answers).length < quiz.questions.length) {
      setErr('Please answer all questions before submitting.');
      return;
    }
    const { score: s, total } = score();
    setBusy(true);
    const { error } = await supabase.from('questionnaire_responses').upsert({
      academy_id: academyId,
      rules_key: quiz.rulesKey,
      responder_name: responderName.trim(),
      responder_role: responderRole.trim() || null,
      answers,
      score: s,
      total,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'academy_id,rules_key' });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSubmitted(true);
    onSubmitted();
  }

  function retake() {
    setAnswers({});
    setSubmitted(false);
  }

  const live = score();
  const passed = submitted && live.score >= quiz.passMark;

  return (
    <div className="p-5 space-y-4">
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Your name *</label>
            <input value={responderName} onChange={e => setResponderName(e.target.value)} disabled={submitted}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Role</label>
            <input value={responderRole} onChange={e => setResponderRole(e.target.value)} disabled={submitted}
              placeholder="Coach / Director" className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100" />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">Answering on behalf of <strong>{academyName}</strong>.</p>
      </div>

      <ol className="space-y-4">
        {quiz.questions.map((q, qi) => {
          const sel = answers[q.id];
          return (
            <li key={q.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="font-semibold text-slate-800 text-sm mb-2"><span className="text-slate-400 mr-1">{qi + 1}.</span>{q.q}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {q.choices.map((c, ci) => {
                  const chosen = sel === ci;
                  const isCorrect = ci === q.correct;
                  let cls = 'border-slate-200 hover:border-blue-300 hover:bg-blue-50';
                  if (submitted) {
                    if (isCorrect) cls = 'border-emerald-400 bg-emerald-50 text-emerald-900';
                    else if (chosen) cls = 'border-red-400 bg-red-50 text-red-900';
                    else cls = 'border-slate-200 text-slate-500';
                  } else if (chosen) {
                    cls = 'border-blue-500 bg-blue-50 text-blue-900';
                  }
                  return (
                    <button key={ci}
                      type="button"
                      onClick={() => pick(q.id, ci)}
                      disabled={submitted}
                      className={`text-left text-sm border rounded-lg px-3 py-2 transition ${cls}`}
                    >
                      <span className="font-bold mr-2 text-xs">{String.fromCharCode(65 + ci)}.</span>{c}
                      {submitted && isCorrect && <span className="float-right">✓</span>}
                      {submitted && chosen && !isCorrect && <span className="float-right">✗</span>}
                    </button>
                  );
                })}
              </div>
              {submitted && q.hint && sel !== q.correct && (
                <p className="text-xs text-slate-500 mt-2">💡 {q.hint}</p>
              )}
            </li>
          );
        })}
      </ol>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {!submitted ? (
        <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-sm text-slate-600">
            Answered: <strong>{Object.keys(answers).length}</strong> / {quiz.questions.length}
            <span className="text-xs text-slate-400 ml-3">Pass mark: {quiz.passMark}/{quiz.questions.length}</span>
          </p>
          <button onClick={submit} disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-xl text-sm">
            {busy ? 'Submitting…' : 'Submit Quiz'}
          </button>
        </div>
      ) : (
        <div className={`rounded-xl p-4 ${passed ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
          <p className={`font-bold text-base ${passed ? 'text-emerald-800' : 'text-amber-800'}`}>
            Score: {live.score} / {live.total} {passed ? '— PASSED ✓' : `— below pass mark of ${quiz.passMark}`}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Recorded by {responderName} · {new Date().toLocaleString()}
          </p>
          <button onClick={retake} className="mt-3 text-xs font-semibold text-slate-600 underline">
            Retake quiz (overwrites previous score)
          </button>
        </div>
      )}
    </div>
  );
}
