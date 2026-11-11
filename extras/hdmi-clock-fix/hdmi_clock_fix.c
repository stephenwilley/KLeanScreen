// SPDX-License-Identifier: GPL-2.0-only
#include <linux/clk.h>
#include <linux/clk-provider.h>
#include <linux/device.h>
#include <linux/err.h>
#include <linux/module.h>
#include <linux/platform_device.h>

#define HDMI_DEVICE_NAME "fe0a0000.hdmi"

/*
 * The HDMI "ref" clock is a mux: parent 0 is the HPLL output, parent 1 is
 * hpll_ph0 (HPLL / 2). The HPLL itself is a mux whose parent 1 is pll_hpll.
 * So: select pll_hpll for the HPLL, run it at twice the target, and feed ref
 * from the half-rate tap. Parents are looked up by index, not by the current
 * parent, so a second run (the loader retries) walks the same clocks.
 */

static unsigned long target_rate = 37125000;
module_param(target_rate, ulong, 0444);
MODULE_PARM_DESC(target_rate, "Requested RK3568 HDMI reference-clock rate");

static bool rate_ok(unsigned long rate)
{
	return rate >= target_rate - target_rate / 1000 &&
	       rate <= target_rate + target_rate / 1000;
}

static int __init hdmi_clock_fix_init(void)
{
	struct device *dev;
	struct clk *ref;
	struct clk *half;
	struct clk *hpll;
	struct clk *pll;
	struct clk *parent;
	struct clk_hw *half_hw;
	struct clk_hw *hpll_hw;
	struct clk_hw *pll_hw;
	struct clk_hw *ref_hw;
	unsigned long before;
	unsigned long after;
	int ret;

	dev = bus_find_device_by_name(&platform_bus_type, NULL,
				      HDMI_DEVICE_NAME);
	if (!dev) {
		pr_err("hdmi_clock_fix: cannot find %s\n", HDMI_DEVICE_NAME);
		return -ENODEV;
	}

	ref = clk_get(dev, "ref");
	put_device(dev);
	if (IS_ERR(ref)) {
		ret = PTR_ERR(ref);
		pr_err("hdmi_clock_fix: cannot get HDMI ref clock: %d\n", ret);
		return ret;
	}
	before = clk_get_rate(ref);
	if (rate_ok(before)) {
		pr_info("hdmi_clock_fix: ref already %lu, nothing to do\n", before);
		clk_put(ref);
		return 0;
	}

	ref_hw = __clk_get_hw(ref);
	hpll_hw = ref_hw ? clk_hw_get_parent_by_index(ref_hw, 0) : NULL;
	half_hw = ref_hw ? clk_hw_get_parent_by_index(ref_hw, 1) : NULL;
	pll_hw = hpll_hw ? clk_hw_get_parent_by_index(hpll_hw, 1) : NULL;
	if (!hpll_hw || !pll_hw || !half_hw) {
		pr_err("hdmi_clock_fix: cannot walk the HPLL parent hierarchy\n");
		clk_put(ref);
		return -ENOENT;
	}
	hpll = clk_hw_get_clk(hpll_hw, "hdmi-clock-fix-hpll");
	pll = clk_hw_get_clk(pll_hw, "hdmi-clock-fix-pll");
	half = clk_hw_get_clk(half_hw, "hdmi-clock-fix-half");
	if (IS_ERR(hpll) || IS_ERR(pll) || IS_ERR(half)) {
		ret = IS_ERR(hpll) ? PTR_ERR(hpll) : IS_ERR(pll) ? PTR_ERR(pll) : PTR_ERR(half);
		pr_err("hdmi_clock_fix: cannot acquire HPLL parent clocks: %d\n",
		       ret);
		goto out;
	}

	parent = clk_get_parent(ref);
	pr_info("hdmi_clock_fix: before: ref=%lu parent_rate=%lu\n",
		before, parent ? clk_get_rate(parent) : 0);

	ret = clk_set_parent(hpll, pll);
	if (ret) {
		pr_err("hdmi_clock_fix: cannot select pll_hpll: %d\n", ret);
		goto out;
	}

	ret = clk_set_rate(hpll, target_rate * 2);
	if (ret) {
		pr_err("hdmi_clock_fix: cannot set HPLL to %lu: %d\n",
		       target_rate * 2, ret);
		goto out;
	}

	ret = clk_set_parent(ref, half);
	if (ret) {
		pr_err("hdmi_clock_fix: cannot select hpll_ph0: %d\n", ret);
		goto out;
	}

	after = clk_get_rate(ref);
	parent = clk_get_parent(ref);
	pr_info("hdmi_clock_fix: after: ref=%lu parent_rate=%lu\n",
		after, parent ? clk_get_rate(parent) : 0);
	if (!rate_ok(after)) {
		pr_err("hdmi_clock_fix: resulting rate is outside 0.1%% tolerance\n");
		ret = -ERANGE;
	}

out:
	if (!IS_ERR(half))
		clk_put(half);
	if (!IS_ERR(pll))
		clk_put(pll);
	if (!IS_ERR(hpll))
		clk_put(hpll);
	clk_put(ref);
	return ret;
}

static void __exit hdmi_clock_fix_exit(void)
{
	pr_info("hdmi_clock_fix: unloaded (clock setting is unchanged)\n");
}

module_init(hdmi_clock_fix_init);
module_exit(hdmi_clock_fix_exit);

MODULE_DESCRIPTION("One-shot RK3568 HDMI reference-clock recovery");
MODULE_AUTHOR("OpenAI Codex");
MODULE_LICENSE("GPL");
