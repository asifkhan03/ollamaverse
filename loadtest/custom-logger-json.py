import time, json, random, string, sys

def random_txn():
    return {
        "transaction_id": ''.join(random.choices(string.ascii_uppercase + string.digits, k=12)),
        "user_id": random.randint(1000, 9999),
        "amount": round(random.uniform(10.0, 5000.0), 2),
        "currency": random.choice(["USD", "INR", "EUR"]),
        "status": random.choice(["SUCCESS", "FAILED", "PENDING"]),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "merchant": random.choice(["AMAZON", "PAYTM", "STRIPE", "RAZORPAY"]),
        "card_type": random.choice(["VISA", "MASTERCARD", "UPI"]),
        "processing_time_ms": random.randint(20, 500),
        "region": random.choice(["us-east-1", "ap-south-1", "eu-west-1"]),
        "retry_count": random.randint(0, 2),
        "log_level": random.choice(["INFO", "WARN", "ERROR"])
    }

# 10 MB per minute ≈ 10 * 1024 * 1024 / 60 = 174,762 bytes per second
TARGET_BYTES_PER_SEC = int(10 * 1024 * 1024 / 60)

def generate_logs():
    while True:
        start = time.time()
        written = 0
        while written < TARGET_BYTES_PER_SEC:
            log = json.dumps(random_txn())
            sys.stdout.write(log + "\n")
            sys.stdout.flush()
            written += len(log) + 1
        elapsed = time.time() - start
        if elapsed < 1:
            time.sleep(1 - elapsed)

if __name__ == "__main__":
    generate_logs()

