#!/bin/bash
SHAS="b924171 37d1636 141333f ca7b93b 76509c7 e93fb8e 7a00f18 2e422b8 01dc96b 8d3c555 b78e8e9 d9977cf 2920bf8 4391f6a 708ba20 3a70379 d4b7a31 868fbff b753c24 40238c3 7d792f9 e6ebefc 4a146ad 1f882cd 3e21114 579a26b ac2f39b 03e315b 27dec39 22b4c8e 3b4f960 ea4d576 761b854 6382631 360064c 224d2bd 0e5b7e7 eff22d4 75eb40b 4b365d9 60ed829 b965c70 a41d059 3a253e2 19ad203 b39a7c4 9f4feec 63580c4 f1e0b21 894edcf 72bee9e 0bfce6b ec0ed32 8c9b096 ee1a8cf 7d929bc 47e803d a699166 62110e9 b93adac 958c966 f8b7ac8 1857cf9 2175f67 354608d 8fe95df 9de5eb7 d1e423c e8ef8db 819a8c9"

PATHS="src/containers/CheckoutPage* src/containers/OrderPanel* src/components/BookingDatesForm* src/containers/EstimatedCustomerBreakdownMaybe* src/ducks/CheckoutPage* src/ducks/TransactionPage* src/util/booking* src/util/transactions* src/components/StripePaymentForm* src/containers/CheckoutPageWithPayment* ext/transaction-processes/** server/**"

> _diffs/all_files.txt

for sha in $SHAS; do
  git diff --name-status $sha..origin/main -- $PATHS 2>/dev/null | while read status file rest; do
    echo "$sha|$status|$file" >> _diffs/all_files.txt
  done
done
