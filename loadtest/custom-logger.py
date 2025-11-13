import time, random, string, sys

LOG_LEVELS = ["INFO", "WARN", "ERROR"]
MERCHANTS = ["AMAZON", "PAYTM", "STRIPE", "RAZORPAY"]
CURRENCIES = ["USD", "INR", "EUR"]
CARD_TYPES = ["VISA", "MASTERCARD", "UPI"]
REGIONS = ["us-east-1", "ap-south-1", "eu-west-1"]

TARGET_BYTES_PER_SEC = int(10 * 1024 * 1024 / 60)  # ~174 KB/s

def random_txn_log():
    level = random.choice(LOG_LEVELS)
    txn_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=12))
    user_id = random.randint(1000, 9999)
    amount = round(random.uniform(10.0, 5000.0), 2)
    currency = random.choice(CURRENCIES)
    merchant = random.choice(MERCHANTS)
    region = random.choice(REGIONS)
    retry = random.randint(0, 2)

    if level == "INFO":
        msg = f"Payment succeeded for txn={txn_id} user={user_id} amount={amount} {currency} via={merchant} in {region}"
    elif level == "WARN":
        msg = f"Retry {retry} for txn={txn_id} user={user_id} still pending with {merchant} region={region}"
    else:
        msg = f"Payment failed txn={txn_id} user={user_id} reason=Card Declined via={merchant} region={region}"

    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    return f"{ts} [{level}] {msg}"

def generate_logs():
    while True:
        start = time.time()
        written = 0
        while written < TARGET_BYTES_PER_SEC:
            line = random_txn_log()
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
            written += len(line) + 1
        elapsed = time.time() - start
        if elapsed < 1:
            time.sleep(1 - elapsed)

if __name__ == "__main__":
    generate_logs()
