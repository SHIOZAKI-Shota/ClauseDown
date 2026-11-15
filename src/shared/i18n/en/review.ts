import type { Messages } from '../types'

export const review: Messages['review'] = {
    title: (label) => `Review request: ${label}`,
    actions: {
        request: 'Request review',
        approve: 'Approve',
        changes: 'Request changes',
        comment: 'Comment',
        withdraw: 'Withdraw request',
    },
    events: {
        request: 'requested review',
        approve: 'approved',
        changes: 'requested changes',
        comment: 'commented',
        withdraw: 'withdrew the request',
    },
    done: {
        request: 'Review requested',
        approve: 'Approved',
        changes: 'Changes requested',
        comment: 'Comment added',
        withdraw: 'Request withdrawn',
    },
    commentRequired: 'Enter a comment',
    rules: (required, approvers) =>
        `Approval: ${required ? 'required to merge into current' : 'optional'} / Approvers: ${approvers.length ? approvers.join(', ') : 'anyone except the requester'}`,
    noEvents: 'No activity yet.',
    unsaved: 'You have unsaved changes',
    unsavedHint: 'Reviewers see saved versions only. Click "Save version" first.',
    placeholderOpen: 'Comment (required when requesting changes)',
    placeholderNew: 'Anything reviewers should look at (optional)',
    requestAgain: 'Request review again',
    compareWithCurrent: 'Compared with current version',
    noDiff: 'No differences from the current version.',
    headDraft: 'Draft',
    headCurrent: 'Current version',
}
