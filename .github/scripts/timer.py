import time
import datetime

def main():
    DURATION = 3 * 60  # 3 دقائق بالثواني
    start_time = time.time()
    end_time = start_time + DURATION

    print("=" * 50)
    print("🐍 بدأ تشغيل سكربت Python")
    print(f"⏰ وقت البدء: {datetime.datetime.now().strftime('%H:%M:%S')}")
    print(f"⏳ المدة: 3 دقائق (180 ثانية)")
    print("=" * 50)

    step = 0
    while time.time() < end_time:
        elapsed = int(time.time() - start_time)
        remaining = DURATION - elapsed
        step += 1

        # طباعة كل 15 ثانية
        if elapsed % 15 == 0:
            mins_elapsed = elapsed // 60
            secs_elapsed = elapsed % 60
            mins_remain = remaining // 60
            secs_remain = remaining % 60
            print(f"[{elapsed:3d}s] ✅ الخطوة #{step:4d} | "
                  f"مضى: {mins_elapsed}:{secs_elapsed:02d} | "
                  f"متبقي: {mins_remain}:{secs_remain:02d}")

        time.sleep(1)

    total_time = time.time() - start_time
    print("=" * 50)
    print(f"🎉 انتهى السكربت بنجاح!")
    print(f"⏰ وقت الانتهاء: {datetime.datetime.now().strftime('%H:%M:%S')}")
    print(f"⏱️  الوقت الكلي: {total_time:.1f} ثانية")
    print(f"📊 عدد الخطوات: {step}")
    print("=" * 50)

if __name__ == "__main__":
    main()
