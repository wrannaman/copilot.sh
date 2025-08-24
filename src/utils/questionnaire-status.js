// Utility functions for managing questionnaire status

export async function updateQuestionnaireStatus(questionnaireId, supabase) {
  try {
    console.log('🔍 [STATUS-UPDATE] Checking questionnaire completion status for:', questionnaireId);

    // Get all questionnaire items
    const { data: items, error: itemsError } = await supabase
      .from('questionnaire_items')
      .select('id, status, draft_answer, final_answer')
      .eq('questionnaire_id', questionnaireId);

    if (itemsError) {
      throw new Error(`Failed to fetch questionnaire items: ${itemsError.message}`);
    }

    if (!items || items.length === 0) {
      console.log('⚠️ [STATUS-UPDATE] No items found for questionnaire:', questionnaireId);
      return false;
    }

    // Check completion criteria
    const totalItems = items.length;
    const processedItems = items.filter(item =>
      item.draft_answer || item.final_answer
    );
    const approvedItems = items.filter(item =>
      item.status === 'approved' || item.status === 'reviewed' || item.final_answer
    );

    console.log(`📊 [STATUS-UPDATE] Stats - Total: ${totalItems}, Processed: ${processedItems.length}, Approved: ${approvedItems.length}`);

    let newStatus = 'draft';
    let completedAt = null;

    // Determine new status based on completion
    if (approvedItems.length === totalItems) {
      // All items are approved/finalized
      newStatus = 'completed';
      completedAt = new Date().toISOString();
      console.log('✅ [STATUS-UPDATE] All items approved - marking as completed');
    } else if (processedItems.length === totalItems) {
      // All items have AI answers but may need review
      newStatus = 'needs_review';
      console.log('🔍 [STATUS-UPDATE] All items processed but need review');
    } else if (processedItems.length > 0) {
      // Some items processed - keep as needs review for now
      newStatus = 'needs_review';
      console.log('⏳ [STATUS-UPDATE] Partial processing - marking as needs review');
    } else {
      // No items processed yet
      newStatus = 'draft';
      console.log('📝 [STATUS-UPDATE] No items processed - marking as draft');
    }

    // Update questionnaire status
    const updateData = {
      status: newStatus,
      updated_at: new Date().toISOString()
    };

    if (completedAt) {
      updateData.ai_processing_completed_at = completedAt;
    }

    const { error: updateError } = await supabase
      .from('questionnaires')
      .update(updateData)
      .eq('id', questionnaireId);

    if (updateError) {
      throw new Error(`Failed to update questionnaire status: ${updateError.message}`);
    }

    console.log(`🎯 [STATUS-UPDATE] Successfully updated questionnaire ${questionnaireId} to status: ${newStatus}`);
    return { status: newStatus, completed: newStatus === 'completed' };

  } catch (error) {
    console.error('❌ [STATUS-UPDATE] Error updating questionnaire status:', error);
    throw error;
  }
}

export async function markQuestionnaireCompleted(questionnaireId, supabase) {
  try {
    const { error } = await supabase
      .from('questionnaires')
      .update({
        status: 'completed',
        ai_processing_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', questionnaireId);

    if (error) throw error;

    console.log('✅ [STATUS-UPDATE] Manually marked questionnaire as completed:', questionnaireId);
    return true;
  } catch (error) {
    console.error('❌ [STATUS-UPDATE] Failed to mark questionnaire as completed:', error);
    throw error;
  }
}

// Status display helpers
export function getStatusLabel(status) {
  switch (status) {
    case 'draft': return 'Draft';
    case 'needs_review': return 'Needs Review';
    case 'completed': return 'Completed';
    case 'approved': return 'Approved';
    default: return status;
  }
}

export function getStatusColor(status) {
  switch (status) {
    case 'draft': return 'bg-gray-500';
    case 'needs_review': return 'bg-yellow-500';
    case 'completed': return 'bg-green-500';
    case 'approved': return 'bg-green-600';
    default: return 'bg-gray-500';
  }
}

export function getStatusVariant(status) {
  switch (status) {
    case 'draft': return 'outline';
    case 'needs_review': return 'destructive';
    case 'completed': return 'success';
    case 'approved': return 'success';
    default: return 'outline';
  }
}
