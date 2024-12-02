import {toNano} from "ton-core";

export abstract class Metadata {
    static readonly NFT_URI = "my-custom-stake-address.ton";
    static readonly NFT_IMAGE_URI = "my-custom-stake-address.ton/icon.img";
}

export abstract class Conf {
    static readonly electorOpValue = toNano('1.03');
    static readonly minStorageController = toNano('2');
    static readonly minStoragePool = toNano('10');
    static readonly depositFee     = toNano('0.25');
    static readonly poolDepositFee = toNano('1');
    static readonly withdrawlFee   = toNano('0.25');
    static readonly minStake       = toNano('50000');
    static readonly hashUpdateFine = toNano('10');
    static readonly stakeRecoverFine = toNano('10');
    static readonly gracePeriod    = 600;
    static readonly governorQuarantine = 86400;
    static readonly sudoQuarantine = 2 * 24 * 3600;
    static readonly serviceNotificationAmount = toNano('0.02');
    static readonly governanceFee  = 155n * BigInt(2 ** 8);
    static readonly finalizeRoundFee = toNano('1');
    static readonly notificationAmount = toNano('0.1');
    static readonly distributionAmount = toNano('0.2');
    static readonly burnNotificationAmount = toNano('0.01');
    static readonly burnRequestValue = toNano('0.01');
    static readonly disbalanceTolerance = 30;
    static readonly shareBase = BigInt(256*256*256); // divisor?
    static readonly testInterest = 100 << 8;
};

export abstract class Op {
    static readonly controller = {
        top_up : 0xd372158c,
        update_validator_hash : 0xf0fd2250,
        approve : 0x7b4b42e6,
        disapprove : 0xe8a0abfe,
        recover_stake : 0xeb373a05,
        credit : 0x1690c604,
        withdraw_validator : 0x8efed779,
        return_unused_loan : 0xed7378a6,
        send_request_loan: 0x6335b11a,
        newStake: 0x4e73744b
    }
    static readonly elector = {
        new_stake: 0x4e73744b,
        new_stake_ok: 0xf374484c,
        new_stake_error: 0xee6f454c,
        recover_stake: 0x47657424,
        recover_stake_ok: 0xf96f7324,
        recover_stake_error:0xfffffffe
    }
    static readonly pool = {
        request_loan   : 0xe642c965,
        loan_repayment : 0xdfdca27b,
        deposit        : 0x47d54391,
        withdraw       : 0x319B0CDC,
        withdrawal     : 0x0a77535c,
        deploy_controller : 0xb27edcad,
        touch: 0x4bc7c2df,
        donate: 0x73affe21
    }
    static readonly governor = {
        set_sudoer : 0x79e7c016,
        prepare_governance_migration: 0x9971881c,
        set_roles  : 0x5e517f36,
        unhalt  : 0x7247e7a5,
        return_available_funds: 0x55c26cd5,
        set_deposit_settings : 0x9bf5561c,
        set_governance_fee: 0x2aaa96a0
    }
    static readonly sudo = {
        send_message : 0x270695fb,
        upgrade : 0x96e7f528
    }
    static readonly halter = {
        halt : 0x139a1b4e
    }
    static readonly interestManager = {
        set_interest : 0xc9f04485,
        operation_fee : 0x54d37487,
        request_notification : 0xb1ebae06,
        set_operational_params: 0x4485c9f0,
        stats : 0xc1344900,
    }
    static readonly jetton = {
        excesses: 0xd53276db,
        internal_transfer: 0x178d4519,
        transfer_notification: 0x7362d09c,
        burn : 0x595f07bc,
        burn_notification : 0x7bdd97de,
        withdraw_tons : 0x6d8e5e3c,
        withdraw_jettons : 0x768a50b2,

        provide_wallet_address : 0x2c76b973,
        take_wallet_address : 0xd1735400,
        change_content : 0x5773d1f5,
    }
    static readonly payout = {
        init: 0xf5aa8943,
        mint: 0x1674b0a0,
        start_distribution: 0x1140a64f,
        distributed_asset: 0xdb3b8abd
    }
    static readonly nft = {
        ownership_assigned: 0x05138d91
    }
}

export abstract class ControllerState {
    static readonly REST = 0;
    static readonly SENT_BORROWING_REQUEST = 1;
    static readonly SENT_STAKE_REQUEST = 2;
    static readonly FUNDS_STAKEN = 3;
    static readonly SENT_RECOVER_REQUEST = 4;
    static readonly INSOLVENT = 5;
}

export abstract class PoolState {
    static readonly NORMAL = 0;
    static readonly REPAYMENT_ONLY = 1;
}
export abstract class Errors {
 static readonly success = 0;
 static readonly unknown_op = 0xffff;

 static readonly wrong_sender = 0x9283;
 static readonly wrong_state = 0x9284;

 static readonly sudoer = { quarantine : 0xa000};

 static readonly interest_too_low = 0xf100;
 static readonly contradicting_borrowing_params = 0xf101;
 static readonly not_enough_funds_for_loan = 0xf102;
 static readonly too_early_borrowing_request = 0xf105;
 static readonly total_credit_too_high = 0xf103;

 static readonly deposit_amount_too_low = 0xf200;
 static readonly depossits_are_closed   = 0xf201;

 static readonly not_enough_TON_to_process = 0xf300;

 static readonly controller_in_wrong_workchain = 0xf400;
 static readonly credit_book_too_deep = 0xf401;

 static readonly finalizing_active_credit_round = 0xf500;

 static readonly too_early_stake_recover_attempt_count = 0xf600;
 static readonly too_early_stake_recover_attempt_time = 0xf601;
 static readonly too_low_recover_stake_value = 0xf602;
 static readonly not_enough_money_to_pay_fine = 0xf603;

 static readonly too_much_validator_set_counts = 0xf700;
 static readonly no_new_hash = 0xf701;

 static readonly withdrawal_while_credited = 0xf800;
 static readonly incorrect_withdrawal_amount = 0xf801;
 static readonly halted = 0x9285;
 static readonly governor_update_too_soon = 0xa001;
 static readonly governor_update_not_matured = 0xa003;


 static readonly newStake = {
    query_id: 0xf900,
    request_value : 0xf901,
    value_lt_minimum : 0xf902,
    value_too_high : 0xf903,
    wrongly_used_credit : 0xf904,
    solvency_not_guaranteed : 0xf905,
 }


 static readonly controller_not_approved = 0xfa00;
 static readonly multiple_loans_are_prohibited = 0xfa01;
 static readonly too_early_loan_request = 0xfa02;
 static readonly too_late_loan_request = 0xfa03;
 static readonly too_high_loan_request_amount = 0xfa04;

 static readonly no_credit = 0xfb00;
 static readonly too_early_loan_return = 0xfb01;

 static readonly contradicting_operational_params = 0xfc00;
}
