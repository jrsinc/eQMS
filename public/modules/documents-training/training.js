/* Module "Training records" (Documents & training). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t, sec, score, TRAINING_TYPES, PASS_MARK, trainingScore } = Q;
  MODULES.training = {
    name: 'Training records', single: 'training record', group: 'Documents & training', prefix: 'TRN',
    intro: 'Training records per JRS/SOP/QAS/003: attendance (FRM/QAS/002) and assessment (FRM/QAS/034). Pass mark 80%; the training log is signed by both trainee and certified trainer; only trained personnel work independently.',
    list: ['number', 'trainee', 'title', 'trainingType', 'dueDate', 'status'],
    fields: [
      sec('Training (FRM/QAS/002)'),
      { k: 'trainee', label: 'Trainee', type: 'user', req: true },
      { k: 'title', label: 'Topic / subject of training', type: 'text', req: true, full: true },
      { k: 'docRef', label: 'Reference SOP / document no.', type: 'recordref', refTypes: ['documents'] },
      { k: 'docVersion', label: 'Document version', type: 'readonly' },
      { k: 'trainingType', label: 'Type of training', type: 'select', req: true, options: TRAINING_TYPES },
      { k: 'mode', label: 'Mode of training', type: 'select', options: ['Classroom', 'Online (remote)', 'Self-training', 'On-the-job'] },
      { k: 'trainer', label: 'Certified trainer (FRM/QAS/033)', type: 'user' },
      { k: 'dueDate', label: 'Due date', type: 'date', req: true },
      { k: 'trainingDate', label: 'Date of training', type: 'date' },
      { k: 'sourceRecord', label: 'Triggered by (TNI, CAPA, deviation, change control, audit)', type: 'recordref', refTypes: ['tni', 'capa', 'investigations', 'changes', 'selfinspections', 'extaudits', 'documents'] },
      { k: 'attempt', label: 'Attempt', type: 'readonly' },
      sec('Assessment (FRM/QAS/034)'),
      { k: 'assessment', label: 'Written assessment required', type: 'checkbox' },
      { k: 'questions', label: 'Questions', type: 'table', full: true, cols: [{ k: 'question', label: 'Question' }, { k: 'answer', label: 'Answer' }, { k: 'marks', label: 'Marks', type: 'number' }, { k: 'obtained', label: 'Marks obtained', type: 'number' }] },
      { k: 'score', label: 'Result', type: 'computed' },
      { k: 'gapTopic', label: 'Score 80–99%: trainee did not understand the procedure for … (topic explained again)', type: 'textarea', full: true },
      { k: 'notes', label: 'Notes', type: 'textarea', full: true }
    ],
    compute: { score: (d) => { const s = trainingScore(d); return s == null ? '' : `${s}% – ${s >= PASS_MARK ? 'Satisfactory (≥ 80%)' : 'Unsatisfactory (< 80%) – retraining required'}`; } },
    states: ['Assigned', 'In Progress', 'Trainer Evaluation', 'Completed', 'Failed', 'Cancelled'],
    transitions: [
      t('Assigned', 'In Progress', 'Start training', ['any'], { checks: ['isTrainee'] }),
      t('In Progress', 'Completed', 'Sign as read and understood (self-reading)', ['any'], { sign: 'Read and understood – trainee', checks: ['isTrainee', 'trSelfReading'] }),
      t('In Progress', 'Trainer Evaluation', 'Sign training log – trainee', ['any'], { sign: 'Trained – trainee', needs: ['trainer', 'trainingDate', 'mode'], checks: ['isTrainee', 'trNotSelfReading'] }),
      t('Trainer Evaluation', 'Completed', 'Evaluate and sign – certified trainer', ['any'], { sign: 'Evaluated – certified trainer', checks: ['isTrainer', 'certifiedTrainer', 'trPass'] }),
      t('Trainer Evaluation', 'Failed', 'Record unsatisfactory result (< 80%)', ['any'], { sign: 'Evaluated – certified trainer', checks: ['isTrainer', 'certifiedTrainer', 'trFail'] }),
      t('Failed', 'Assigned', 'Retrain and reassess', ['any'], { checks: ['isTrainer'] }),
      t('Assigned', 'Cancelled', 'Cancel', ['trainer', 'qa'], { reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
