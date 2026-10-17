package com.anonymous.bulwarkmobile

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.ConcurrentHashMap

/**
 * Runs the BulwarkCalendarReminders headless JS task from a JobScheduler job,
 * which brings the local calendar reminders up to date without the app UI.
 *
 * Two jobs use it. A push that names a calendar change schedules a one-off job
 * (`scheduleNow`): a fixed job id, so a burst of pushes (every calendar change
 * pushes, the app's own writes included) coalesces into one pending job. And a
 * periodic job every [PERIOD_MS] (`schedulePeriodic`) moves the 7-day horizon
 * forward and catches a push that never arrived. Both need a network, as the
 * task reads the events from the server. Modelled on BulwarkPushJobService.
 */
class BulwarkCalendarReminderJobService : JobService(), HeadlessJsTaskEventListener {
    private class RunningTask(val params: JobParameters, val startedAt: Long)

    private val running = ConcurrentHashMap<Int, RunningTask>()
    private var taskContext: HeadlessJsTaskContext? = null

    override fun onStartJob(params: JobParameters): Boolean {
        // JobService callbacks run on the main thread, where HeadlessJs wants to be called.
        HeadlessJs.withReadyReactContext(application) { startTask(it, params) }
        return true
    }

    // The JS task has its own timeout and finishes on its own; the periodic
    // job comes round again and a push schedules a new one-off.
    override fun onStopJob(params: JobParameters): Boolean {
        running.values.removeIf { it.params.jobId == params.jobId }
        return false
    }

    override fun onDestroy() {
        taskContext?.removeTaskEventListener(this)
        super.onDestroy()
    }

    override fun onHeadlessJsTaskStart(taskId: Int) = Unit

    override fun onHeadlessJsTaskFinish(taskId: Int) {
        val task = running.remove(taskId) ?: return
        val ms = SystemClock.elapsedRealtime() - task.startedAt
        Log.i(TAG, "Reminder task $taskId from job ${task.params.jobId} finished after $ms ms")
        jobFinished(task.params, false)
    }

    private fun startTask(context: ReactContext, params: JobParameters) {
        val tasks = HeadlessJsTaskContext.getInstance(context)
        if (taskContext !== tasks) {
            taskContext?.removeTaskEventListener(this)
            tasks.addTaskEventListener(this)
            taskContext = tasks
        }
        // Not allowed in the foreground: the running app reschedules the
        // reminders itself, from its own StateChange stream.
        val config = HeadlessJsTaskConfig("BulwarkCalendarReminders", Arguments.createMap(), TASK_TIMEOUT_MS, false)
        HeadlessJs.startTask(
            tasks,
            config,
            onStarted = { taskId -> running[taskId] = RunningTask(params, SystemClock.elapsedRealtime()) },
            onRefused = { e ->
                Log.i(TAG, "Reminder job ${params.jobId} skipped: ${e.message}")
                jobFinished(params, false)
            },
        )
    }

    companion object {
        private const val TAG = "BulwarkCalReminders"
        private const val TASK_TIMEOUT_MS = 60_000L

        // Outside the block of push job ids (BulwarkPushJobService, 0x42554c00..0x42554c1f).
        const val ONE_OFF_JOB_ID = 0x42554c40
        const val PERIODIC_JOB_ID = 0x42554c41
        private const val PERIOD_MS = 6 * 60 * 60 * 1000L

        private fun component(context: Context) = ComponentName(context, BulwarkCalendarReminderJobService::class.java)

        /** Schedules the refresh once, now. Returns false if no job could be scheduled. */
        fun scheduleNow(context: Context): Boolean = try {
            val job = JobInfo.Builder(ONE_OFF_JOB_ID, component(context))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setExpedited(true) }
                .build()
            val scheduled = context.getSystemService(JobScheduler::class.java).schedule(job) == JobScheduler.RESULT_SUCCESS
            Log.i(TAG, "Reminder job scheduled: $scheduled")
            scheduled
        } catch (e: Exception) {
            Log.w(TAG, "Reminder job could not be scheduled", e)
            false
        }

        /**
         * Schedules the refresh every [PERIOD_MS], surviving a reboot. Does
         * nothing when the job is already pending: scheduling it again on
         * every app start would restart its period.
         */
        fun schedulePeriodic(context: Context): Boolean = try {
            val scheduler = context.getSystemService(JobScheduler::class.java)
            if (scheduler.getPendingJob(PERIODIC_JOB_ID) != null) {
                true
            } else {
                val job = JobInfo.Builder(PERIODIC_JOB_ID, component(context))
                    .setPeriodic(PERIOD_MS)
                    .setPersisted(true)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .build()
                val scheduled = scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS
                Log.i(TAG, "Periodic reminder job scheduled: $scheduled")
                scheduled
            }
        } catch (e: Exception) {
            Log.w(TAG, "Periodic reminder job could not be scheduled", e)
            false
        }

        fun cancelPeriodic(context: Context) {
            try {
                context.getSystemService(JobScheduler::class.java).cancel(PERIODIC_JOB_ID)
            } catch (e: Exception) {
                Log.w(TAG, "Periodic reminder job could not be cancelled", e)
            }
        }
    }
}
